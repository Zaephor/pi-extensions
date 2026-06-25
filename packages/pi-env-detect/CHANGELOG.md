# Changelog

## 1.0.0 (2026-06-25)


### Features

* **env-detect:** capability probe (kvm/nested/sockets/caps) ([129f1fc](https://github.com/Zaephor/pi-extensions/commit/129f1fcbb79f85a3f47135dc21701f011551b1b4))
* **env-detect:** identity probe (container/vm/nested/k8s) ([6b39b66](https://github.com/Zaephor/pi-extensions/commit/6b39b662c538ac2f0c6b7611257359bb518e4797))
* **env-detect:** prose renderers for injection and tool output ([f93021c](https://github.com/Zaephor/pi-extensions/commit/f93021c8cb20bf8221ef43a4f2001c7179c70772))
* **env-detect:** scaffold package, result types, and SystemAccess seam ([ffa971f](https://github.com/Zaephor/pi-extensions/commit/ffa971fa543d20c74b9d9379c6ace923fa9965d8))
* **env-detect:** scope aggregator with lazy session cache ([3301846](https://github.com/Zaephor/pi-extensions/commit/33018469efdedc7e2e562c5917cbc7f061d98b57))
* **env-detect:** tooling probe over fixed spawn allowlist ([8433ad4](https://github.com/Zaephor/pi-extensions/commit/8433ad4da78d9620445f61439a6f20bb1fcfe7e1))
* **env-detect:** wire tool, prompt injection, command, and flag ([3886ebe](https://github.com/Zaephor/pi-extensions/commit/3886ebef10a13714f57bb6bb8ecdb7e99c008006))


### Bug Fixes

* **env-detect:** attribute podman/crio/containerd, more DMI vendors, single systemd-detect-virt exec ([8d6a3aa](https://github.com/Zaephor/pi-extensions/commit/8d6a3aaa8995728b273d0e6959ec873ec6434123))
* **env-detect:** make scope param optional, cover tool-only mode ([49ca1b1](https://github.com/Zaephor/pi-extensions/commit/49ca1b191371a170c062bb820a49b50300991f18))
* **env-detect:** register flag as env-detect (drop -- prefix), validate mode, sharpen tool copy ([c54b57e](https://github.com/Zaephor/pi-extensions/commit/c54b57e9f69d41dbc7eb83dc71daf5596d2d0a67))
* **env-detect:** require write access to /dev/kvm; cover kvm_amd/sockets/caps/garbage ([cc77812](https://github.com/Zaephor/pi-extensions/commit/cc77812bc998b2726b9e652cab1b0c851fcf40c1))
* **env-detect:** restore brief's detectHypervisor source order; tighten cgroup test ([c999a65](https://github.com/Zaephor/pi-extensions/commit/c999a65929eda294a8e9f77523e67e58e17f12f5))
* **env-detect:** return a copy from detect() to remove the cache-aliasing hazard ([c6b90af](https://github.com/Zaephor/pi-extensions/commit/c6b90af873933c1c5bfda4007ba49ac3597723cd))
* **env-detect:** sanitize env/exec-derived labels before they reach the system prompt ([2549aad](https://github.com/Zaephor/pi-extensions/commit/2549aad3952f5235c0f933c1faf238753604e696))
* **env-detect:** state container-launch capability; render seccomp as a caveat ([c78af52](https://github.com/Zaephor/pi-extensions/commit/c78af52f96a7f82b84458357c79eb6d750964714))
