from PyInstaller.utils.hooks import collect_submodules

hiddenimports = collect_submodules("sdv") + collect_submodules("sdmetrics")

# v2 uses SDV GaussianCopulaSynthesizer only. SDV 1.38 tolerates missing
# CTGAN/PAR dependencies, so keep their neural/GPU stacks out of the bundle.
unused_neural_modules = [
    "ctgan",
    "deepecho",
    "torch",
    "triton",
    "nvidia",
    "cuda",
]

a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=unused_neural_modules,
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="survey-synth-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)
