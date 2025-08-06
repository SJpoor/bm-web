
## 使用方法

### 1. 启动服务端

首先，确保语音识别服务端已经启动：

```bash
python core_server.py
```

服务端会在6016端口启动WebSocket服务，用于接收音频数据并返回识别结果。

### 2. 确保聊天模型API可用

```
http://localhost:11454/api/chat
```

### 3. 启动Web服务器

运行以下命令启动Web服务器：

```bash
python web_server.py
```

默认情况下，Web服务器会在8000端口启动，并自动在默认浏览器中打开测试页面。

如果需要指定其他端口，可以在命令行中指定：

```bash
python web_server.py 8080
```
### 文件说明

- `web_client.html`: Web界面的HTML文件
- `web_client.js`: 处理音频录制、WebSocket通信和聊天模型API通信的JavaScript代码
- `web_server.py`: 提供静态文件的简单Web服务器
