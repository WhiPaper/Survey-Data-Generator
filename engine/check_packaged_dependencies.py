from importlib.metadata import PackageNotFoundError, distributions, metadata, version

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

EXPECTED_SDV_VERSION = "1.38.0"
ALLOWED_MISSING_SDV_REQUIREMENTS = {"ctgan", "deepecho"}
FORBIDDEN_DISTRIBUTIONS = {"ctgan", "deepecho", "torch", "triton"}
FORBIDDEN_PREFIXES = ("nvidia-", "cuda-")


def installed_distribution_names() -> set[str]:
    names: set[str] = set()
    for distribution in distributions():
        name = distribution.metadata.get("Name")
        if name:
            names.add(canonicalize_name(name))
    return names


def main() -> None:
    installed_sdv_version = version("sdv")
    if installed_sdv_version != EXPECTED_SDV_VERSION:
        raise RuntimeError(
            f"Expected sdv {EXPECTED_SDV_VERSION}, found {installed_sdv_version}"
        )

    unsatisfied: list[str] = []
    for raw_requirement in metadata("sdv").get_all("Requires-Dist") or []:
        requirement = Requirement(raw_requirement)
        name = canonicalize_name(requirement.name)
        if requirement.marker is not None and not requirement.marker.evaluate():
            continue
        if name in ALLOWED_MISSING_SDV_REQUIREMENTS:
            continue

        try:
            installed_version = version(requirement.name)
        except PackageNotFoundError:
            unsatisfied.append(f"{requirement}: not installed")
            continue

        if requirement.specifier and installed_version not in requirement.specifier:
            unsatisfied.append(
                f"{requirement}: installed version {installed_version} does not satisfy constraint"
            )

    if unsatisfied:
        details = "\n".join(f"- {item}" for item in unsatisfied)
        raise RuntimeError(f"Packaged Gaussian dependency profile is incomplete:\n{details}")

    installed_names = installed_distribution_names()
    forbidden = sorted(
        name
        for name in installed_names
        if name in FORBIDDEN_DISTRIBUTIONS
        or any(name.startswith(prefix) for prefix in FORBIDDEN_PREFIXES)
    )
    if forbidden:
        raise RuntimeError(
            "Packaged Gaussian dependency profile unexpectedly installed neural/GPU distributions: "
            + ", ".join(forbidden)
        )

    print(
        "Packaged Gaussian dependency profile passed: "
        f"sdv={installed_sdv_version}, neural/GPU distributions absent."
    )


if __name__ == "__main__":
    main()
