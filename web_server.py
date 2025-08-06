import os
import sys
import ssl
from http.server import HTTPServer, SimpleHTTPRequestHandler
import webbrowser
from threading import Timer

# 确保根目录位置正确
BASE_DIR = os.path.dirname(__file__)
os.chdir(BASE_DIR)

class CustomHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 添加CORS头，允许WebSocket连接
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type')
        SimpleHTTPRequestHandler.end_headers(self)

def open_browser(url):
    """在默认浏览器中打开URL"""
    webbrowser.open(url)

def run_server(port=8000, use_https=True):
    """运行HTTP/HTTPS服务器"""
    server_address = ('0.0.0.0', port)  # 明确监听所有网络接口
    httpd = HTTPServer(server_address, CustomHTTPRequestHandler)
    
    protocol = "https" if use_https else "http"
    
    if use_https:
        # 配置SSL
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        cert_path = os.path.join(BASE_DIR, "cert.pem")
        key_path = os.path.join(BASE_DIR, "key.pem")
        
        if os.path.exists(cert_path) and os.path.exists(key_path):
            ssl_context.load_cert_chain(cert_path, key_path)
            httpd.socket = ssl_context.wrap_socket(httpd.socket, server_side=True)
            print("已启用SSL加密")
        else:
            print("警告: SSL证书文件不存在，回退到HTTP模式")
            use_https = False
            protocol = "http"
    
    # 在新线程中打开浏览器
    Timer(1, open_browser, args=[f'{protocol}://localhost:{port}/web/index.html']).start()
    
    print(f"启动Web服务器，监听端口 {port}...")
    print(f"请在浏览器中访问: {protocol}://localhost:{port}/web/index.html")
    print("按Ctrl+C停止服务器")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")
        httpd.server_close()
        sys.exit(0)

if __name__ == "__main__":
    # 获取命令行参数中的端口号，默认为8000
    port = 8000
    use_https = True  # 默认使用HTTPS
    
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"无效的端口号: {sys.argv[1]}")
            sys.exit(1)
    
    # 如果有第二个参数且为"http"，则使用HTTP
    if len(sys.argv) > 2 and sys.argv[2].lower() == "http":
        use_https = False
    
    run_server(port, use_https) 