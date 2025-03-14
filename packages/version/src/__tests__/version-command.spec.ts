// local modules _must_ be explicitly mocked
jest.mock("../lib/git-push", () => jest.requireActual('../lib/__mocks__/git-push'));
jest.mock("../lib/is-anything-committed", () => jest.requireActual('../lib/__mocks__/is-anything-committed'));
jest.mock("../lib/is-behind-upstream", () => jest.requireActual('../lib/__mocks__/is-behind-upstream'));
jest.mock("../lib/remote-branch-exists", () => jest.requireActual('../lib/__mocks__/remote-branch-exists'));

jest.mock('@lerna-lite/core', () => ({
  ...jest.requireActual('@lerna-lite/core') as any, // return the other real methods, below we'll mock only 2 of the methods
  createGitHubClient: jest.requireActual('../../../core/src/__mocks__/github-client').createGitHubClient,
  createGitLabClient: jest.requireActual('../../../core/src/__mocks__/gitlab-client').createGitLabClient,
  parseGitRepo: jest.requireActual('../../../core/src/__mocks__/github-client').parseGitRepo,
  recommendVersion: jest.requireActual('../../../core/src/__mocks__/conventional-commits').recommendVersion,
  updateChangelog: jest.requireActual('../../../core/src/__mocks__/conventional-commits').updateChangelog,
  logOutput: jest.requireActual('../../../core/src/__mocks__/output').logOutput,
  collectUpdates: jest.requireActual("../../../core/src/__mocks__/utils/collect-updates").collectUpdates,
  promptConfirmation: jest.requireActual('../../../core/src/__mocks__/prompt').promptConfirmation,
  promptSelectOne: jest.requireActual('../../../core/src/__mocks__/prompt').promptSelectOne,
  promptTextInput: jest.requireActual('../../../core/src/__mocks__/prompt').promptTextInput,
  checkWorkingTree: jest.requireActual('../../../core/src/__mocks__/check-working-tree').checkWorkingTree,
  throwIfReleased: jest.requireActual('../../../core/src/__mocks__/check-working-tree').throwIfReleased,
  throwIfUncommitted: jest.requireActual('../../../core/src/__mocks__/check-working-tree').throwIfUncommitted,
}));

// also point to the local version command so that all mocks are properly used even by the command-runner
jest.mock('@lerna-lite/version', () => jest.requireActual('../version-command'));

const fs = require("fs-extra");
const path = require("path");
const execa = require("execa");

// mocked or stubbed modules
const writePkg = require("write-pkg");
const { promptConfirmation, promptSelectOne } = require("@lerna-lite/core");
const { collectUpdates } = require("@lerna-lite/core");
const { logOutput } = require("@lerna-lite/core");
const { checkWorkingTree, throwIfUncommitted } = require("@lerna-lite/core");
const { gitPush: libPush } = require("../lib/git-push");
const { isAnythingCommitted } = require("../lib/is-anything-committed");
const { isBehindUpstream } = require("../lib/is-behind-upstream");
const { remoteBranchExists } = require("../lib/remote-branch-exists");

// helpers
const { loggingOutput } = require("@lerna-test/logging-output");
const { gitAdd } = require("@lerna-test/git-add");
const { gitTag } = require("@lerna-test/git-tag");
const { gitCommit } = require("@lerna-test/git-commit");
const initFixture = require("@lerna-test/init-fixture")(path.resolve(__dirname, "../../../publish/src/__tests__"));
const { showCommit } = require("@lerna-test/show-commit");
const { getCommitMessage } = require("@lerna-test/get-commit-message");

// test command
import { VersionCommand } from '../version-command';
const lernaVersion = require("@lerna-test/command-runner")(require("../../../cli/src/cli-commands/cli-version-commands"));

// file under test
const yargParser = require('yargs-parser');

const createArgv = (cwd, ...args) => {
  args.unshift('version');
  const parserArgs = args.map(String);
  const argv = yargParser(parserArgs);
  argv['$0'] = cwd;
  argv['loglevel'] = 'silent';
  return argv;
};

// certain tests need to use the real thing
const collectUpdatesActual = jest.requireActual("@lerna-lite/core").collectUpdates;

// assertion helpers
const listDirty = (cwd) =>
  // git ls-files --exclude-standard --modified --others
  execa("git", ["ls-files", "--exclude-standard", "--modified", "--others"], { cwd }).then((result) =>
    result.stdout.split("\n").filter(Boolean)
  );

// stabilize commit SHA
expect.addSnapshotSerializer(require("@lerna-test/serialize-git-sha"));

describe("VersionCommand", () => {
  describe("normal mode", () => {
    it("versions changed packages", async () => {
      const testDir = await initFixture("normal");
      // when --conventional-commits is absent,
      // --no-changelog should have _no_ effect
      await new VersionCommand(createArgv(testDir, "--no-changelog"));

      expect(checkWorkingTree).toHaveBeenCalled();

      expect(promptSelectOne.mock.calls).toMatchSnapshot("prompt");
      expect(promptConfirmation).toHaveBeenLastCalledWith("Are you sure you want to create these versions?");

      expect(writePkg.updatedManifest("package-1")).toMatchSnapshot("gitHead");

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot("commit");

      expect(libPush).toHaveBeenLastCalledWith(
        "origin",
        "main",
        expect.objectContaining({
          cwd: testDir,
        }),
        undefined
      );
      expect(logOutput.logged()).toMatchSnapshot("console output");
    });

    it("throws an error when --independent is passed", async () => {
      const testDir = await initFixture("normal");
      const command = new VersionCommand(createArgv(testDir, "--independent"));

      await expect(command).rejects.toThrow("independent");
    });

    it("throws an error if conventional prerelease and graduate flags are both passed", async () => {
      const testDir = await initFixture("normal");
      const command = new VersionCommand(createArgv(testDir, "--conventional-prerelease", "--conventional-graduate"));

      await expect(command).rejects.toThrow(
        "--conventional-prerelease cannot be combined with --conventional-graduate."
      );
    });

    it("throws an error when remote branch doesn't exist", async () => {
      remoteBranchExists.mockReturnValueOnce(false);

      const testDir = await initFixture("normal");
      const command = new VersionCommand(createArgv(testDir));

      await expect(command).rejects.toThrow("doesn't exist in remote");
    });

    it("throws an error when uncommitted changes are present", async () => {
      checkWorkingTree.mockImplementationOnce(() => {
        throw new Error("uncommitted");
      });

      const testDir = await initFixture("normal");
      const command = new VersionCommand(createArgv(testDir));

      await expect(command).rejects.toThrow("uncommitted");
      // notably different than the actual message, but good enough here
    });

    it("throws an error when current ref is already tagged", async () => {
      checkWorkingTree.mockImplementationOnce(() => {
        throw new Error("released");
      });

      const testDir = await initFixture("normal");
      const command = new VersionCommand(createArgv(testDir));

      await expect(command).rejects.toThrow("released");
      // notably different than the actual message, but good enough here
    });

    it("calls `throwIfUncommitted` when using --force-publish", async () => {
      const testDir = await initFixture("normal");

      await new VersionCommand(createArgv(testDir, "--force-publish"));

      expect(throwIfUncommitted).toHaveBeenCalled();
    });

    it("only bumps changed packages when non-major version selected", async () => {
      const testDir = await initFixture("normal");

      collectUpdates.setUpdated(testDir, "package-3");
      promptSelectOne.chooseBump("minor");

      await new VersionCommand(createArgv(testDir));

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot();
    });

    it("bumps all packages when major version selected", async () => {
      const testDir = await initFixture("normal");

      collectUpdates.setUpdated(testDir, "package-3");
      promptSelectOne.chooseBump("major");

      await new VersionCommand(createArgv(testDir));

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot();
    });

    it("does not bump major of private packages with --no-private", async () => {
      const testDir = await initFixture("normal");

      // despite being a pendant leaf...
      collectUpdates.setUpdated(testDir, "package-4");
      promptSelectOne.chooseBump("major");

      await new VersionCommand(createArgv(testDir, "--no-private"));

      const patch = await showCommit(testDir, "--name-only");
      expect(patch).not.toContain("package-5");
      // ...all packages are still majored
      expect(patch).toContain("package-1");
    });
  });

  describe("independent mode", () => {
    it("versions changed packages", async () => {
      // mock version prompt choices
      promptSelectOne.chooseBump("patch");
      promptSelectOne.chooseBump("minor");
      promptSelectOne.chooseBump("major");
      promptSelectOne.chooseBump("minor");
      promptSelectOne.chooseBump("patch");

      const testDir = await initFixture("independent");
      await new VersionCommand(createArgv(testDir)); // --independent is only valid in InitCommand

      expect(promptConfirmation).toHaveBeenCalled();

      expect(writePkg.updatedManifest("package-1")).toMatchSnapshot("gitHead");

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot("commit");

      expect(libPush).toHaveBeenLastCalledWith(
        "origin",
        "main",
        expect.objectContaining({
          cwd: testDir,
        }), undefined
      );
      expect(logOutput.logged()).toMatchSnapshot("console output");
    });
  });

  describe("--no-commit-hooks", () => {
    const setupPreCommitHook = (cwd) =>
      fs.outputFile(path.join(cwd, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });

    it("passes --no-verify to git commit execution", async () => {
      const cwd = await initFixture("normal");

      await setupPreCommitHook(cwd);
      await new VersionCommand(createArgv(cwd, "--no-commit-hooks"));

      const message = await getCommitMessage(cwd);
      expect(message).toBe("v1.0.1");
    });

    it("consumes configuration from lerna.json", async () => {
      const cwd = await initFixture("normal");

      await setupPreCommitHook(cwd);
      await fs.outputJSON(path.join(cwd, "lerna.json"), {
        version: "1.0.0",
        command: {
          publish: {
            commitHooks: false,
          },
        },
      });
      await new VersionCommand(createArgv(cwd));

      const message = await getCommitMessage(cwd);
      expect(message).toBe("v1.0.1");
    });
  });

  describe("--no-git-tag-version", () => {
    it("versions changed packages without git commit or push", async () => {
      const testDir = await initFixture("normal");
      await new VersionCommand(createArgv(testDir, "--no-git-tag-version"));

      expect(writePkg.updatedManifest("package-1")).toMatchSnapshot("gitHead");

      expect(libPush).not.toHaveBeenCalled();

      const logMessages = loggingOutput("info");
      expect(logMessages).toContain("Skipping git tag/commit");

      const unstaged = await listDirty(testDir);
      expect(unstaged).toEqual([
        "lerna.json",
        "packages/package-1/package.json",
        "packages/package-2/package.json",
        "packages/package-3/package.json",
        "packages/package-4/package.json",
        "packages/package-5/package.json",
      ]);
    });

    it("consumes configuration from lerna.json", async () => {
      const testDir = await initFixture("normal");

      await fs.outputJSON(path.join(testDir, "lerna.json"), {
        version: "1.0.0",
        command: {
          publish: {
            gitTagVersion: false,
          },
        },
      });
      await new VersionCommand(createArgv(testDir));

      const logMessages = loggingOutput("info");
      expect(logMessages).toContain("Skipping git tag/commit");
    });

    it("is implied by --skip-git", async () => {
      const testDir = await initFixture("normal");
      await lernaVersion(testDir)("--skip-git");

      const logMessages = loggingOutput();
      expect(logMessages).toContain("Skipping git tag/commit");
      expect(logMessages).toContain("--skip-git has been replaced by --no-git-tag-version --no-push");
    });

    it("skips dirty working tree validation", async () => {
      const testDir = await initFixture("normal");
      await fs.outputFile(path.join(testDir, "packages/package-1/hello.js"), "world");
      await new VersionCommand(createArgv(testDir, "--no-git-tag-version"));

      expect(checkWorkingTree).not.toHaveBeenCalled();

      const logMessages = loggingOutput("warn");
      expect(logMessages).toContain("Skipping working tree validation, proceed at your own risk");

      const unstaged = await listDirty(testDir);
      expect(unstaged).toContain("packages/package-1/hello.js");
    });
  });

  // TODO: (major) make --no-granular-pathspec the default
  describe("--no-granular-pathspec", () => {
    const getLeftover = (cwd) =>
      execa("git", ["ls-files", "--others"], { cwd }).then((result) => result.stdout);

    it("adds changed files globally", async () => {
      const cwd = await initFixture("normal");
      await fs.outputFile(path.join(cwd, ".gitignore"), "packages/dynamic");
      await fs.outputJSON(path.join(cwd, "packages/dynamic/package.json"), {
        name: "dynamic",
        version: "1.0.0",
      });
      // a "dynamic", intentionally unversioned package must _always_ be forced
      await new VersionCommand(createArgv(cwd, "--force-publish=dynamic", "--no-granular-pathspec"));

      const leftover = await getLeftover(cwd);
      expect(leftover).toBe("packages/dynamic/package.json");
    });

    it("consumes configuration from lerna.json", async () => {
      const cwd = await initFixture("normal");
      await fs.outputFile(path.join(cwd, ".gitignore"), "packages/dynamic");
      await fs.outputJSON(path.join(cwd, "packages/dynamic/package.json"), {
        name: "dynamic",
        version: "1.0.0",
      });
      await fs.outputJSON(path.join(cwd, "lerna.json"), {
        version: "1.0.0",
        granularPathspec: false,
      });
      // a "dynamic", intentionally unversioned package must _always_ be forced
      await new VersionCommand(createArgv(cwd, "--force-publish=dynamic"));

      const leftover = await getLeftover(cwd);
      expect(leftover).toBe("packages/dynamic/package.json");
    });
  });

  // TODO: (major) make --no-private the default
  describe("--no-private", () => {
    it("does not universally version private packages", async () => {
      const testDir = await initFixture("normal");
      await new VersionCommand(createArgv(testDir, "--no-private"));

      const patch = await showCommit(testDir, "--name-only");
      expect(patch).not.toContain("package-5");
    });

    it("does not independently version private packages", async () => {
      const testDir = await initFixture("independent");
      await new VersionCommand(createArgv(testDir, "--no-private"));

      const patch = await showCommit(testDir, "--name-only");
      expect(patch).not.toContain("package-5");
    });

    it("consumes configuration from lerna.json", async () => {
      const testDir = await initFixture("normal");

      await fs.outputJSON(path.join(testDir, "lerna.json"), {
        version: "1.0.0",
        command: {
          version: {
            private: false,
          },
        },
      });
      await new VersionCommand(createArgv(testDir));

      const patch = await showCommit(testDir, "--name-only");
      expect(patch).not.toContain("package-5");
    });
  });

  describe("--no-push", () => {
    it("versions changed packages without git push", async () => {
      const testDir = await initFixture("normal");
      await new VersionCommand(createArgv(testDir, "--no-push"));

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot();

      expect(libPush).not.toHaveBeenCalled();

      const logMessages = loggingOutput("info");
      expect(logMessages).toContain("Skipping git push");

      const unstaged = await listDirty(testDir);
      expect(unstaged).toEqual([]);
    });

    it("consumes configuration from lerna.json", async () => {
      const testDir = await initFixture("normal");

      await fs.outputJSON(path.join(testDir, "lerna.json"), {
        version: "1.0.0",
        command: {
          publish: {
            push: false,
          },
        },
      });
      await new VersionCommand(createArgv(testDir));

      const logMessages = loggingOutput("info");
      expect(logMessages).toContain("Skipping git push");
    });

    it("is implied by --skip-git", async () => {
      const testDir = await initFixture("normal");
      await lernaVersion(testDir)("--skip-git");

      const logMessages = loggingOutput();
      expect(logMessages).toContain("Skipping git push");
      expect(logMessages).toContain("--skip-git has been replaced by --no-git-tag-version --no-push");
    });
  });

  describe("--tag-version-prefix", () => {
    it("versions changed packages with custom tag prefix", async () => {
      const testDir = await initFixture("normal");
      await new VersionCommand(createArgv(testDir, "--tag-version-prefix", "rev"));

      const patch = await showCommit(testDir);
      expect(patch).toContain("tag: rev1.0.1");
    });

    it("consumes configuration from lerna.json", async () => {
      const testDir = await initFixture("normal");

      await fs.outputJSON(path.join(testDir, "lerna.json"), {
        version: "1.0.0",
        command: {
          publish: {
            tagVersionPrefix: "durable",
          },
        },
      });
      await new VersionCommand(createArgv(testDir));

      const patch = await showCommit(testDir);
      expect(patch).toContain("tag: durable1.0.1");
    });

    it("omits tag prefix when passed empty string", async () => {
      const testDir = await initFixture("normal");
      await new VersionCommand(createArgv(testDir, "--tag-version-prefix", ""));

      const patch = await showCommit(testDir);
      expect(patch).toContain("tag: 1.0.1");
    });
  });

  describe("--yes", () => {
    it("skips confirmation prompt", async () => {
      const testDir = await initFixture("normal");
      await new VersionCommand(createArgv(testDir, "--bump", "patch", "--yes"));

      expect(promptSelectOne).not.toHaveBeenCalled();
      expect(promptConfirmation).not.toHaveBeenCalled();

      const message = await getCommitMessage(testDir);
      expect(message).toBe("v1.0.1");
    });
  });

  describe("--exact", () => {
    it("updates matching local dependencies of published packages with exact versions", async () => {
      const testDir = await initFixture("normal");
      await new VersionCommand(createArgv(testDir, "--exact"));

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot();
    });

    it("updates existing exact versions", async () => {
      const testDir = await initFixture("normal-exact");
      await new VersionCommand(createArgv(testDir));

      const patch = await showCommit(testDir);
      expect(patch).toMatchSnapshot();
    });
  });

  describe("--git-remote", () => {
    it("pushes tags to specified remote", async () => {
      const testDir = await initFixture("normal");
      await new VersionCommand(createArgv(testDir, "--git-remote", "upstream"));

      expect(libPush).toHaveBeenLastCalledWith(
        "upstream",
        "main",
        expect.objectContaining({
          cwd: testDir,
        }),
        undefined
      );
    });

    it("consumes configuration from lerna.json", async () => {
      const testDir = await initFixture("normal");

      await fs.outputJSON(path.join(testDir, "lerna.json"), {
        version: "1.0.0",
        command: {
          publish: {
            gitRemote: "durable",
          },
        },
      });
      await new VersionCommand(createArgv(testDir));

      expect(libPush).toHaveBeenLastCalledWith(
        "durable",
        "main",
        expect.objectContaining({
          cwd: testDir,
        }),
        undefined
      );
    });
  });

  describe("--amend", () => {
    it("amends the previous commit", async () => {
      const testDir = await initFixture("normal", "previous");
      await new VersionCommand(createArgv(testDir, "--amend"));

      const message = await getCommitMessage(testDir);
      expect(message).toBe("previous");

      expect(checkWorkingTree).not.toHaveBeenCalled();
    });

    it("ignores custom messages", async () => {
      const testDir = await initFixture("normal", "preserved");
      await new VersionCommand(createArgv(testDir, "-m", "ignored", "--amend"));

      const message = await getCommitMessage(testDir);
      expect(message).toBe("preserved");
    });
  });

  describe("--amend --independent", () => {
    it("amends the previous commit", async () => {
      const testDir = await initFixture("independent", "previous");
      await new VersionCommand(createArgv(testDir, "--amend"));

      const message = await getCommitMessage(testDir);
      expect(message).toBe("previous");
    });
  });

  describe("when local clone is behind upstream", () => {
    it("throws an error during interactive publish", async () => {
      isBehindUpstream.mockReturnValueOnce(true);

      const testDir = await initFixture("normal");
      const command = new VersionCommand(createArgv(testDir, "--no-ci"));

      await expect(command).rejects.toThrow("Please merge remote changes");
    });

    it("logs a warning and exits early during CI publish", async () => {
      isBehindUpstream.mockReturnValueOnce(true);

      const testDir = await initFixture("normal");

      await new VersionCommand(createArgv(testDir, "--ci"));

      const [warning] = loggingOutput("warn");
      expect(warning).toMatch("behind remote upstream");
      expect(warning).toMatch("exiting");
    });
  });

  describe("unversioned packages", () => {
    it("exits with an error for non-private packages with no version", async () => {
      const testDir = await initFixture("not-versioned");
      const command = new VersionCommand(createArgv(testDir));

      await expect(command).rejects.toThrow("A version field is required in package-3's package.json file.");
    });

    it("ignores private packages with no version", async () => {
      const testDir = await initFixture("not-versioned-private");
      await new VersionCommand(createArgv(testDir));
      expect(Object.keys(writePkg.updatedVersions())).not.toContain("package-4");
    });
  });

  describe("working on a detached HEAD", () => {
    const detachedHEAD = async (fixture = "normal") => {
      const cwd = await initFixture(fixture);
      const { stdout: sha } = await execa("git", ["rev-parse", "HEAD"], { cwd });
      await execa("git", ["checkout", sha], { cwd });
      return cwd;
    };

    it("throws by default", async () => {
      const cwd = await detachedHEAD();
      const command = new VersionCommand(createArgv(cwd));

      await expect(command).rejects.toThrow(
        "Detached git HEAD, please checkout a branch to choose versions."
      );
    });

    it("does not throw for version --no-git-tag-version", async () => {
      const cwd = await detachedHEAD();
      await new VersionCommand(createArgv(cwd, "--no-git-tag-version"));
      const unstaged = await listDirty(cwd);
      expect(unstaged).toEqual([
        "lerna.json",
        "packages/package-1/package.json",
        "packages/package-2/package.json",
        "packages/package-3/package.json",
        "packages/package-4/package.json",
        "packages/package-5/package.json",
      ]);
    });

    it("throws for version --conventional-commits", async () => {
      const cwd = await detachedHEAD();
      const command = new VersionCommand(createArgv(cwd, "--no-git-tag-version", "--conventional-commits"));

      await expect(command).rejects.toThrow(
        "Detached git HEAD, please checkout a branch to choose versions."
      );
    });

    it("throws for version --allow-branch", async () => {
      const cwd = await detachedHEAD();
      const command = new VersionCommand(createArgv(cwd, "--no-git-tag-version", "--allow-branch", "main"));

      await expect(command).rejects.toThrow(
        "Detached git HEAD, please checkout a branch to choose versions."
      );
    });
  });

  it("exits with an error when no commits are present", async () => {
    isAnythingCommitted.mockReturnValueOnce(false);

    const testDir = await initFixture("normal", false);
    const command = new VersionCommand(createArgv(testDir));

    await expect(command).rejects.toThrow(
      "No commits in this repository. Please commit something before using version."
    );
  });

  it("exits early when no changes found", async () => {
    const cwd = await initFixture("normal");

    collectUpdates.setUpdated(cwd);

    await new VersionCommand(createArgv(cwd));

    const logMessages = loggingOutput("success");
    expect(logMessages).toContain("No changed packages to version");
  });

  it("versions all transitive dependents after change", async () => {
    const testDir = await initFixture("snake-graph");

    await gitTag(testDir, "v1.0.0");
    await fs.outputFile(path.join(testDir, "packages/package-1/hello.js"), "world");
    await gitAdd(testDir, ".");
    await gitCommit(testDir, "feat: hello");

    collectUpdates.mockImplementationOnce(collectUpdatesActual);

    await new VersionCommand(createArgv(testDir, "--bump", "major", "--yes"));

    const patch = await showCommit(testDir);
    expect(patch).toMatchSnapshot();
  });

  it("versions all packages with cycles", async () => {
    const testDir = await initFixture("cycle-parent");

    await gitTag(testDir, "v1.0.0");

    await Promise.all(
      ["a", "b", "c", "d"].map((n) => fs.outputFile(path.join(testDir, "packages", n, "index.js"), "hello"))
    );
    await gitAdd(testDir, ".");
    await gitCommit(testDir, "feat: hello");

    collectUpdates.mockImplementationOnce(collectUpdatesActual);

    await new VersionCommand(createArgv(testDir, "--bump", "major", "--yes"));

    const patch = await showCommit(testDir, "--name-only");
    expect(patch).toMatchInlineSnapshot(`
      "v2.0.0

      HEAD -> main, tag: v2.0.0

      lerna.json
      packages/a/package.json
      packages/b/package.json
      packages/c/package.json
      packages/d/package.json"
    `);
  });

  describe("with relative file: specifiers", () => {
    const setupChanges = async (cwd, pkgRoot = "packages") => {
      await gitTag(cwd, "v1.0.0");
      await fs.outputFile(path.join(cwd, `${pkgRoot}/package-1/hello.js`), "world");
      await gitAdd(cwd, ".");
      await gitCommit(cwd, "setup");
    };

    it("does not overwrite relative specifier in git commit", async () => {
      const testDir = await initFixture("relative-file-specs");

      await setupChanges(testDir);
      await new VersionCommand(createArgv(testDir, "--bump", "major", "--yes"));

      expect(writePkg.updatedVersions()).toEqual({
        "package-1": "2.0.0",
        "package-2": "2.0.0",
        "package-3": "2.0.0",
        "package-4": "2.0.0",
        "package-5": "2.0.0",
        "package-6": "2.0.0",
        "package-7": "2.0.0",
      });

      // package-1 has no relative file: dependencies
      expect(writePkg.updatedManifest("package-2").dependencies).toMatchObject({
        "package-1": "file:../package-1",
      });
      expect(writePkg.updatedManifest("package-3").dependencies).toMatchObject({
        "package-2": "file:../package-2",
      });
      expect(writePkg.updatedManifest("package-4").optionalDependencies).toMatchObject({
        "package-3": "file:../package-3",
      });
      expect(writePkg.updatedManifest("package-5").dependencies).toMatchObject({
        "package-4": "file:../package-4",
        "package-6": "file:../package-6",
      });
    });
  });

  describe("--include-merged-tags", () => {
    it("accepts --include-merged-tags", async () => {
      const testDir = await initFixture("normal");
      await new VersionCommand(createArgv(testDir, "--include-merged-tags", "--yes", "--bump", "patch"));

      expect(promptSelectOne).not.toHaveBeenCalled();
      expect(promptConfirmation).not.toHaveBeenCalled();

      const message = await getCommitMessage(testDir);
      expect(message).toBe("v1.0.1");
    });
  });

  describe("with leaf lockfiles", () => {
    it("updates lockfile version to new package version", async () => {
      const cwd = await initFixture("lockfile-leaf");
      await new VersionCommand(createArgv(cwd, "--yes", "--bump", "major"));

      const changedFiles = await showCommit(cwd, "--name-only");
      expect(changedFiles).toContain("packages/package-1/package-lock.json");
    });
  });

  describe("with spurious -- arguments", () => {
    it("ignores the extra arguments with cheesy parseConfiguration()", async () => {
      const cwd = await initFixture("lifecycle");
      await lernaVersion(cwd)("--yes", "--", "--loglevel", "ignored", "--blah");

      const logMessages = loggingOutput("warn");
      expect(logMessages).toContain("Arguments after -- are no longer passed to subprocess executions.");
    });
  });
});
