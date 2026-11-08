"""Servidor local de IPSC Track (sin caché, para ver siempre la última versión)."""
import http.server
import os
import socketserver
import sys

PORT = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8080))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript", ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("", PORT), NoCacheHandler) as httpd:
        print(f"IPSC Track en http://localhost:{PORT}")
        httpd.serve_forever()
