# Changelog

## [0.2.7](https://github.com/Zaephor/pi-extensions/compare/pi-monorepo-registry-v0.2.6...pi-monorepo-registry-v0.2.7) (2026-05-20)


### Bug Fixes

* resolve stale version reporting in monorepo-registry list ([1795bb5](https://github.com/Zaephor/pi-extensions/commit/1795bb5a9cffbe8d290e8a340bcd56e301beadf8))

## [0.2.6](https://github.com/Zaephor/pi-extensions/compare/pi-monorepo-registry-v0.2.5...pi-monorepo-registry-v0.2.6) (2026-05-16)


### Bug Fixes

* harden subcommand dispatch and improve git update reliability ([109589a](https://github.com/Zaephor/pi-extensions/commit/109589a1ff70ec34600d45982d30ec41c689b5fb))

## [0.2.5](https://github.com/Zaephor/pi-extensions/compare/pi-monorepo-registry-v0.2.4...pi-monorepo-registry-v0.2.5) (2026-05-15)


### Bug Fixes

* mock paths.js in integration tests to prevent real state.json corruption ([81aa0f4](https://github.com/Zaephor/pi-extensions/commit/81aa0f4898eb0636aca69518da8abe026a1a3118))

## [0.2.4](https://github.com/Zaephor/pi-extensions/compare/pi-monorepo-registry-v0.2.3...pi-monorepo-registry-v0.2.4) (2026-05-15)


### Bug Fixes

* update cloned sources correctly instead of using stale cache ([4852eec](https://github.com/Zaephor/pi-extensions/commit/4852eec213bf85574f0ceecf88c5b6037000692e))

## [0.2.3](https://github.com/Zaephor/pi-extensions/compare/pi-monorepo-registry-v0.2.2...pi-monorepo-registry-v0.2.3) (2026-05-13)


### Bug Fixes

* harden registry state persistence against concurrent access and crashes ([3dcf7b3](https://github.com/Zaephor/pi-extensions/commit/3dcf7b35820b4f4e21335e33771bea469928ec9c))

## [0.2.2](https://github.com/Zaephor/pi-extensions/compare/pi-monorepo-registry-v0.2.1...pi-monorepo-registry-v0.2.2) (2026-05-12)


### Bug Fixes

* unshallow git clones before updating registry sources ([6b2da92](https://github.com/Zaephor/pi-extensions/commit/6b2da925efd016392d204cdbfed221ed185e2bd6))

## [0.2.1](https://github.com/Zaephor/pi-extensions/compare/pi-monorepo-registry-v0.2.0...pi-monorepo-registry-v0.2.1) (2026-05-04)


### Bug Fixes

* Use files allowlist for release tarballs instead of exclusion-based packing ([6cd6716](https://github.com/Zaephor/pi-extensions/commit/6cd671671111a282654c38a83bfcac249d80aa79))

## [0.2.0](https://github.com/Zaephor/pi-extensions/compare/pi-monorepo-registry-v0.1.1...pi-monorepo-registry-v0.2.0) (2026-05-04)


### Features

* /monorepo-list shows installed packages alongside sources ([7f1ed16](https://github.com/Zaephor/pi-extensions/commit/7f1ed1668bb11d863063b2974a4a008feb3721ef))
* add gsd-pi devDependency and resolve cross-runtime imports ([f377201](https://github.com/Zaephor/pi-extensions/commit/f377201cef058513f8c4126405021a3f71b17383))
* Create settings.json bridge with atomic read/write for extension… ([9136a54](https://github.com/Zaephor/pi-extensions/commit/9136a5422f85e09be2445b28050857efcbe73ead))
* cross-runtime e2e tests for all plugins ([55ef48a](https://github.com/Zaephor/pi-extensions/commit/55ef48a02b28fc5135feb7dee4ad4c0e17d4199a))
* display registry-loaded extensions at startup ([331e3dd](https://github.com/Zaephor/pi-extensions/commit/331e3dd2e35853c9ad8fec4940a7b1b972ce984d))
* registry-managed extension loading with runtime isolation ([6b9fa4e](https://github.com/Zaephor/pi-extensions/commit/6b9fa4ee06ffe1b5e4d78b39eab8339ab070bbca))
* short name source refs, duplicate blocking, and state persistence ([e4967fe](https://github.com/Zaephor/pi-extensions/commit/e4967fe09c9e09c6318e01487956ceedb6cc082f))


### Bug Fixes

* ensure node_modules before loading extensions ([34d88bc](https://github.com/Zaephor/pi-extensions/commit/34d88bc87f43ca38ce5be1167fc521edd5c88622))
* Fix release workflow tag format alignment (single-dash -v), add ta… ([f469b64](https://github.com/Zaephor/pi-extensions/commit/f469b645eda1daae9b5dca0d29960e7a3b68ffd2))
* forward pi events to sub-extensions via registry proxy ([6572aef](https://github.com/Zaephor/pi-extensions/commit/6572aefcaeecbc70ae2e5c49f47199b3f4b00501))
* load sub-extensions in factory, not session_start ([b0a5961](https://github.com/Zaephor/pi-extensions/commit/b0a5961ffce8056f0160e68d8783a2c021e2a3bd))
* make persistence resilient to getAgentDir() failures ([ae156b9](https://github.com/Zaephor/pi-extensions/commit/ae156b93ebf74c08cf59bc4529670f33fad2e799))
* mirror pi's getAliases() for jiti module resolution ([4fbacaf](https://github.com/Zaephor/pi-extensions/commit/4fbacaf3aa3b464bb1d494eb1d6c5baf8d0e33a8))
* release-please typo and CLI e2e flakiness ([57aa258](https://github.com/Zaephor/pi-extensions/commit/57aa258907c8b3d1960564761c8ba3d9ce8cc50a))
* Resolve CI lint failures and CLI e2e agent_start test ([43ed7f9](https://github.com/Zaephor/pi-extensions/commit/43ed7f9afb9b355228a0421dddee0248cc60f248))
* resolve extension dependencies from extension's directory ([5657b21](https://github.com/Zaephor/pi-extensions/commit/5657b213143bd9d888bbdb8bb14fe21831fb88f5))
* resolve git URLs to local paths for package discovery ([059171a](https://github.com/Zaephor/pi-extensions/commit/059171a7776d0fe5fba4e36f555c86e5f5fd8ee5))
* single notify for startup banner to avoid overwrite ([51293b8](https://github.com/Zaephor/pi-extensions/commit/51293b8ab8b99fbfae91b93204d4d4f7c31cedc3))
* Updated cross-runtime helpers to use new /monorego-package install… ([d1fecc7](https://github.com/Zaephor/pi-extensions/commit/d1fecc7afa8ab51d2d1f4bac56fbb7676aa2690f))

## [0.1.1](https://github.com/Zaephor/pi-extensions/compare/pi-monorepo-registry-v0.1.0...pi-monorepo-registry-v0.1.1) (2026-04-29)


### Bug Fixes

* set both PI_ and GSD_ agent dir env vars in global install test ([d1a5f95](https://github.com/Zaephor/pi-extensions/commit/d1a5f95db2cbcbbd5e51518652d961ee49156224))
