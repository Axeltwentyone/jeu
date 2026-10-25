# Serveur local de développement : comme `python3 -m http.server`, mais sans cache navigateur
# (sinon les modules JS modifiés ne sont pas rechargés).
import http.server, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256  # le navigateur ouvre beaucoup de connexions à la fois (modules, textures) : file d'attente large
    daemon_threads = True

Server(('', port), NoCache).serve_forever()
