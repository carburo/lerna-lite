[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)
[![npm](https://img.shields.io/npm/v/@lerna-lite/publish.svg?color=forest)](https://www.npmjs.com/package/@lerna-lite/publish)
[![npm](https://img.shields.io/npm/dy/@lerna-lite/publish?color=forest)](https://www.npmjs.com/package/@lerna-lite/publish)
[![Actions Status](https://github.com/ghiscoding/lerna-lite/workflows/CI%20Build/badge.svg)](https://github.com/ghiscoding/lerna-lite/actions)

# @lerna-lite/publish
## (`lerna publish`) Publish command 📰

Lerna-Lite Publish command, publish packages in the current project

### Internal Dependencies
- [@lerna-lite/core](https://github.com/ghiscoding/lerna-lite/tree/main/packages/core)
- [@lerna-lite/version](https://github.com/ghiscoding/lerna-lite/tree/main/packages/version)

---

## Installation
```sh
# install globally
npm install -g @lerna-lite/cli
# then use it (see usage below)
lerna publish

# OR use npx
npx lerna publish
```

## Usage

```sh
lerna publish              # publish packages that have changed since the last release
lerna publish from-git     # explicitly publish packages tagged in the current commit
lerna publish from-package # explicitly publish packages where the latest version is not present in the registry
```

When run, this command does one of the following things:

- Publish packages updated since the last release (calling [`lerna version`](https://github.com/ghiscoding/lerna-lite/blob/main/packages/version/README.md) behind the scenes).
  - This is the legacy behavior of lerna 2.x
- Publish packages tagged in the current commit (`from-git`).
- Publish packages in the latest commit where the version is not present in the registry (`from-package`).
- Publish an unversioned "canary" release of packages (and their dependents) updated in the previous commit.

> lerna will never publish packages which are marked as private (`"private": true` in the `package.json`).

During all publish operations, appropriate [lifecycle scripts](#lifecycle-scripts) are called in the root and per-package (unless disabled by [`--ignore-scripts](#--ignore-scripts)).

Check out [Per-Package Configuration](#per-package-configuration) for more details about publishing scoped packages, custom registries, and custom dist-tags.

## Positionals

### semver `--bump from-git`

In addition to the semver keywords supported by [`lerna version`](https://github.com/lerna/lerna/tree/main/commands/version#positionals),
`lerna publish` also supports the `from-git` keyword.
This will identify packages tagged by `lerna version` and publish them to npm.
This is useful in CI scenarios where you wish to manually increment versions,
but have the package contents themselves consistently published by an automated process.

### semver `--bump from-package`

Similar to the `from-git` keyword except the list of packages to publish is determined by inspecting each `package.json`
and determining if any package version is not present in the registry. Any versions not present in the registry will
be published.
This is useful when a previous `lerna publish` failed to publish all packages to the registry.

## Options

`lerna publish` supports all of the options provided by [`lerna version`](https://github.com/lerna/lerna/tree/main/commands/version#options) in addition to the following:
- [`@lerna/publish`](#lernapublish)
  - [Positionals](#positionals)
    - [semver `--bump from-git`](#semver--bump-from-git)
    - [semver `--bump from-package`](#semver--bump-from-package)
  - [Options](#options)
    - [`--canary`](#--canary)
    - [`--contents <dir>`](#--contents-dir)
    - [`--dist-tag <tag>`](#--dist-tag-tag)
    - [`--force-publish`](#--force-publish)
    - [`--git-head <sha>`](#--git-head-sha)
    - [`--graph-type <all|dependencies>`](#--graph-type-alldependencies)
    - [`--ignore-scripts`](#--ignore-scripts)
    - [`--ignore-prepublish`](#--ignore-prepublish)
    - [`--legacy-auth`](#--legacy-auth)
    - [`--no-git-reset`](#--no-git-reset)
    - [`--no-granular-pathspec`](#--no-granular-pathspec)
    - [`--no-verify-access`](#--no-verify-access)
    - [`--otp`](#--otp)
    - [`--preid`](#--preid)
    - [`--pre-dist-tag <tag>`](#--pre-dist-tag-tag)
    - [`--registry <url>`](#--registry-url)
    - [`--tag-version-prefix`](#--tag-version-prefix)
    - [`--temp-tag`](#--temp-tag)
    - [`--yes`](#--yes)

### `--canary`

```sh
lerna publish --canary
# 1.0.0 => 1.0.1-alpha.0+${SHA} of packages changed since the previous commit
# a subsequent canary publish will yield 1.0.1-alpha.1+${SHA}, etc

lerna publish --canary --preid beta
# 1.0.0 => 1.0.1-beta.0+${SHA}

# The following are equivalent:
lerna publish --canary minor
lerna publish --canary preminor
# 1.0.0 => 1.1.0-alpha.0+${SHA}
```

When run with this flag, `lerna publish` publishes packages in a more granular way (per commit).
Before publishing to npm, it creates the new `version` tag by taking the current `version`, bumping it to the next _minor_ version, adding the provided meta suffix (defaults to `alpha`) and appending the current git sha (ex: `1.0.0` becomes `1.1.0-alpha.0+81e3b443`).

If you have publish canary releases from multiple active development branches in CI,
it is recommended to customize the [`--preid`](#--preid) and [`--dist-tag <tag>`](#--dist-tag-tag) on a per-branch basis to avoid clashing versions.

> The intended use case for this flag is a per commit level release or nightly release.

### `--contents <dir>`

Subdirectory to publish. Must apply to ALL packages, and MUST contain a package.json file.
Package lifecycles will still be run in the original leaf directory.
You should probably use one of those lifecycles (`prepare`, `prepublishOnly`, or `prepack`) to _create_ the subdirectory and whatnot.

If you're into unnecessarily complicated publishing, this will give you joy.

```sh
lerna publish --contents dist
# publish the "dist" subfolder of every lerna-managed leaf package
```

**NOTE:** You should wait until the `postpublish` lifecycle phase (root or leaf) to clean up this generated subdirectory,
as the generated package.json is used during package upload (_after_ `postpack`).

### `--dist-tag <tag>`

```sh
lerna publish --dist-tag next
```

When run with this flag, `lerna publish` will publish to npm with the given npm [dist-tag](https://docs.npmjs.com/cli/v8/commands/npm-dist-tag) (defaults to `latest`).

This option can be used to publish a [`prerelease`](http://carrot.is/coding/npm_prerelease) or `beta` version under a non-`latest` dist-tag, helping consumers avoid automatically upgrading to prerelease-quality code.

> Note: the `latest` tag is the one that is used when a user runs `npm install my-package`.
> To install a different tag, a user can run `npm install my-package@prerelease`.

### `--force-publish`

To be used with [`--canary`](#--canary) to publish a canary version of all packages in your monorepo. This flag can be helpful when you need to make canary releases of packages beyond what was changed in the most recent commit.

```sh
lerna publish --canary --force-publish
```

### `--git-head <sha>`

Explicit SHA to set as [`gitHead`](https://git.io/fh7np) on manifests when packing tarballs, only allowed with [`from-package`](#bump-from-package) positional.

For example, when publishing from AWS CodeBuild (where `git` is not available),
you could use this option to pass the appropriate [environment variable](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-env-vars.html) to use for this package metadata:

```sh
lerna publish from-package --git-head ${CODEBUILD_RESOLVED_SOURCE_VERSION}
```

Under all other circumstances, this value is derived from a local `git` command.

### `--graph-type <all|dependencies>`

Set which kind of dependencies to use when building a package graph. The default value is `dependencies`, whereby only packages listed in the `dependencies` section of a package's `package.json` are included. Pass `all` to include both `dependencies` _and_ `devDependencies` when constructing the package graph and determining topological order.

When using traditional peer + dev dependency pairs, this option should be configured to `all` so the peers are always published before their dependents.

```sh
lerna publish --graph-type all
```

Configured via `lerna.json`:

```json
{
  "command": {
    "publish": {
      "graphType": "all"
    }
  }
}
```

### `--ignore-scripts`

When passed, this flag will disable running [lifecycle scripts](#lifecycle-scripts) during `lerna publish`.

### `--ignore-prepublish`

When passed, this flag will disable running [deprecated](https://docs.npmjs.com/misc/scripts#prepublish-and-prepare) [`prepublish` scripts](#lifecycle-scripts) during `lerna publish`.

### `--legacy-auth`

When publishing packages that require authentication but you are working with an internally hosted NPM Registry that only uses the legacy Base64 version of username:password. This is the same as the NPM publish `_auth` flag.

```sh
lerna publish --legacy-auth aGk6bW9t
```

### `--no-git-reset`

By default, `lerna publish` ensures any changes to the working tree have been reset.

To avoid this, pass `--no-git-reset`. This can be especially useful when used as part of a CI pipeline in conjunction with the `--canary` flag. For instance, the `package.json` version numbers which have been bumped may need to be used in subsequent CI pipeline steps (such as Docker builds).

```sh
lerna publish --no-git-reset
```

### `--no-granular-pathspec`

By default, `lerna publish` will attempt (if enabled) to `git checkout` _only_ the leaf package manifests that are temporarily modified during the publishing process. This yields the equivalent of `git checkout -- packages/*/package.json`, but tailored to _exactly_ what changed.

If you **know** you need different behavior, you'll understand: Pass `--no-granular-pathspec` to make the git command _literally_ `git checkout -- .`. By opting into this [pathspec](https://git-scm.com/docs/gitglossary#Documentation/gitglossary.txt-aiddefpathspecapathspec), you must have all intentionally unversioned content properly ignored.

This option makes the most sense configured in `lerna.json`, as you really don't want to mess it up:

```json
{
  "version": "independent",
  "granularPathspec": false
}
```

The root-level configuration is intentional, as this also covers the [identically-named option in `lerna version`](https://github.com/lerna/lerna/tree/main/commands/version#--no-granular-pathspec).

### `--no-verify-access`

By default, `lerna` will verify the logged-in npm user's access to the packages about to be published. Passing this flag will disable that check.

If you are using a third-party registry that does not support `npm access ls-packages`, you will need to pass this flag (or set `command.publish.verifyAccess` to `false` in `lerna.json`).

> Please use with caution

### `--otp`

When publishing packages that require two-factor authentication, you can specify a [one-time password](https://docs.npmjs.com/about-two-factor-authentication) using `--otp`:

```sh
lerna publish --otp 123456
```

> Please keep in mind that one-time passwords expire within 30 seconds of their generation. If it expires during publish operations, a prompt will request a refreshed value before continuing.

### `--preid`

Unlike the `lerna version` option of the same name, this option only applies to [`--canary`](#--canary) version calculation.

```sh
lerna publish --canary
# uses the next semantic prerelease version, e.g.
# 1.0.0 => 1.0.1-alpha.0

lerna publish --canary --preid next
# uses the next semantic prerelease version with a specific prerelease identifier, e.g.
# 1.0.0 => 1.0.1-next.0
```

When run with this flag, `lerna publish --canary` will increment `premajor`, `preminor`, `prepatch`, or `prerelease` semver
bumps using the specified [prerelease identifier](http://semver.org/#spec-item-9).

### `--pre-dist-tag <tag>`

```sh
lerna publish --pre-dist-tag next
```

Works the same as [`--dist-tag`](#--dist-tag-tag), except only applies to packages being released with a prerelease version.

### `--registry <url>`

When run with this flag, forwarded npm commands will use the specified registry for your package(s).

This is useful if you do not want to explicitly set up your registry
configuration in all of your package.json files individually when e.g. using
private registries.

### `--tag-version-prefix`

This option allows to provide custom prefix instead of the default one: `v`.

Keep in mind, if splitting `lerna version` and `lerna publish`, you need to pass it to both commands:

```bash
# locally
lerna version --tag-version-prefix=''

# on ci
lerna publish from-git --tag-version-prefix=''
```

You could also configure this at the root level of `lerna.json`, applying to both commands equally:

```json
{
  "tagVersionPrefix": "",
  "packages": ["packages/*"],
  "version": "independent"
}
```

### `--temp-tag`

When passed, this flag will alter the default publish process by first publishing
all changed packages to a temporary dist-tag (`lerna-temp`) and then moving the
new version(s) to the dist-tag configured by [`--dist-tag`](#--dist-tag-tag) (default `latest`).

This is not generally necessary, as lerna will publish packages in topological
order (all dependencies before dependents) by default.

### `--yes`

```sh
lerna publish --canary --yes
# skips `Are you sure you want to publish the above changes?`
```

When run with this flag, `lerna publish` will skip all confirmation prompts.
Useful in [Continuous integration (CI)](https://en.wikipedia.org/wiki/Continuous_integration) to automatically answer the publish confirmation prompt.

## Per-Package Configuration

A leaf package can be configured with special [`publishConfig`](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#publishconfig) that in _certain_ circumstances changes the behavior of `lerna publish`.

### `publishConfig.access`

To publish packages with a scope (e.g., `@mycompany/rocks`), you must set [`access`](https://docs.npmjs.com/cli/v8/using-npm/config#access):

```json
  "publishConfig": {
    "access": "public"
  }
```

- If this field is set for a package _without_ a scope, it **will** fail.
- If you _want_ your scoped package to remain private (i.e., `"restricted"`), there is no need to set this value.

  Note that this is **not** the same as setting `"private": true` in a leaf package; if the `private` field is set, that package will _never_ be published under any circumstances.

### `publishConfig.registry`

You can customize the registry on a per-package basis by setting [`registry`](https://docs.npmjs.com/cli/v8/using-npm/config#registry):

```json
  "publishConfig": {
    "registry": "http://my-awesome-registry.com/"
  }
```

- Passing [`--registry`](#--registry-url) applies globally, and in some cases isn't what you want.

### `publishConfig.tag`

You can customize the dist-tag on a per-package basis by setting [`tag`](https://docs.npmjs.com/cli/v8/using-npm/config#tag):

```json
  "publishConfig": {
    "tag": "flippin-sweet"
  }
```

- Passing [`--dist-tag`](#--dist-tag-tag) will _overwrite_ this value.
- This value is _always_ ignored when [`--canary`](#--canary) is passed.

### `publishConfig.directory`

This _non-standard_ field allows you to customize the published subdirectory just like [`--contents`](#--contents-dir), but on a per-package basis. All other caveats of `--contents` still apply.

```json
  "publishConfig": {
    "directory": "dist"
  }
```

<a id="lifecycle-events"><!-- back-compat with previous heading --></a>

## Lifecycle Scripts

```js
// prepublish:      Run BEFORE the package is packed and published.
// prepare:         Run BEFORE the package is packed and published, AFTER prepublish, BEFORE prepublishOnly.
// prepublishOnly:  Run BEFORE the package is packed and published, ONLY on npm publish.
// prepack:     Run BEFORE a tarball is packed.
// postpack:    Run AFTER the tarball has been generated and moved to its final destination.
// publish:     Run AFTER the package is published.
// postpublish: Run AFTER the package is published.
```

lerna will run [npm lifecycle scripts](https://docs.npmjs.com/cli/v8/using-npm/scripts#description) during `lerna publish` in the following order:

1. If versioning implicitly, run all [version lifecycle scripts](https://github.com/lerna/lerna/tree/main/commands/version#lifecycle-scripts)
2. Run `prepublish` lifecycle in root, if [enabled](#--ignore-prepublish)
3. Run `prepare` lifecycle in root
4. Run `prepublishOnly` lifecycle in root
5. Run `prepack` lifecycle in root
6. For each changed package, in topological order (all dependencies before dependents):
   1. Run `prepublish` lifecycle, if [enabled](#--ignore-prepublish)
   2. Run `prepare` lifecycle
   3. Run `prepublishOnly` lifecycle
   4. Run `prepack` lifecycle
   5. Create package tarball in temp directory via [JS API](https://github.com/ghiscoding/lerna-lite/blob/main/packages/publish/src/lib/pack-directory.ts)
   6. Run `postpack` lifecycle
7. Run `postpack` lifecycle in root
8. For each changed package, in topological order (all dependencies before dependents):
   1. Publish package to configured [registry](#--registry-url) via [JS API](https://github.com/ghiscoding/lerna-lite/blob/main/packages/publish/src/lib/npm-publish.ts)
   2. Run `publish` lifecycle
   3. Run `postpublish` lifecycle
9. Run `publish` lifecycle in root
   - To avoid recursive calls, don't use this root lifecycle to run `lerna publish`
10. Run `postpublish` lifecycle in root
11. Update temporary dist-tag to latest, if [enabled](#--temp-tag)

