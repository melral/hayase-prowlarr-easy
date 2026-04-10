from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

HOST = "127.0.0.1"
PORT = 8765


class CorsHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/proxy?"):
            self.handle_proxy()
            return

        super().do_GET()

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def handle_proxy(self):
        parsed = urlparse(self.path)
        target = parse_qs(parsed.query).get("url", [None])[0]

        if not target:
            self.send_response(400)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Missing url query parameter.")
            return

        target_url = urlparse(target)
        if target_url.scheme not in {"http", "https"}:
            self.send_response(400)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Proxy target must be an http or https URL.")
            return

        request = Request(
            target,
            headers={
                "Accept": self.headers.get("Accept", "*/*"),
                "User-Agent": "hayase-prowlarr-local-proxy/1.0",
            },
        )

        try:
            with urlopen(request, timeout=10) as response:
                body = response.read()
                self.send_response(response.status)
                self.send_header(
                    "Content-Type",
                    response.headers.get("Content-Type", "text/plain; charset=utf-8"),
                )
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except HTTPError as error:
            body = error.read()
            self.send_response(error.code)
            self.send_header(
                "Content-Type",
                error.headers.get("Content-Type", "text/plain; charset=utf-8"),
            )
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (URLError, TimeoutError, OSError) as error:
            body = f"Proxy error: {error}".encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), CorsHandler)
    print(f"Serving on http://{HOST}:{PORT}")
    server.serve_forever()
