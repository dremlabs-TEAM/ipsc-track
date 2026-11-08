"""Marca una nueva versión de IPSC Track antes de publicarla.

Añade ?v=<versión> a todas las rutas de JS/CSS propias, para que los navegadores
descarguen siempre los archivos nuevos en lugar de usar los de la caché, y
actualiza version.json, que la app consulta al abrirse para recargarse sola.

Uso:  python tools/bump_version.py            (versión = fecha y hora actual)
      python tools/bump_version.py 2026.11.08  (versión explícita)
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime("%Y%m%d-%H%M")

# import ... from './x.js'  |  import './x.js'  (solo rutas relativas propias)
JS_IMPORT = re.compile(r"""((?:from|import)\s+['"])(\./[^'"?]+\.js)(?:\?v=[^'"]*)?(['"])""")
# src="js/app.js"  |  href="css/styles.css"
HTML_ASSET = re.compile(r"""((?:src|href)=")((?:js|css)/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?(")""")


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def main() -> None:
    changed = 0
    for path in sorted((ROOT / "js").glob("*.js")):
        src = path.read_text(encoding="utf-8")
        out = JS_IMPORT.sub(lambda m: f"{m[1]}{m[2]}?v={VERSION}{m[3]}", src)
        if path.name == "version.js":
            out = re.sub(r"VERSION = '[^']*'", f"VERSION = '{VERSION}'", out)
        if out != src:
            write(path, out)
            changed += 1
    index = ROOT / "index.html"
    src = index.read_text(encoding="utf-8")
    out = HTML_ASSET.sub(lambda m: f"{m[1]}{m[2]}?v={VERSION}{m[3]}", src)
    if out != src:
        write(index, out)
        changed += 1
    write(ROOT / "version.json", json.dumps({"version": VERSION}) + "\n")
    print(f"Versión {VERSION} · {changed} archivos actualizados + version.json")


if __name__ == "__main__":
    main()
