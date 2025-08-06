
### Windows 端

```powershell
pip install -r requirements-server.txt
pip install -r requirements-client.txt
```

有些依赖在 `Python 3.11` 还暂时不无法安装，建议使用 `Python 3.8 - Python3.10`  


## 源码运行

1. 运行 `core_server.py` 脚本，会载入 Paraformer 模型识别模型和标点模型（这会占用2GB的内存，载入时长约 50 秒）
2. 运行 `core_client.py` 脚本，它会打开系统默认麦克风，开始监听按键（`MacOS` 端需要 `sudo`）
3. 按住 `CapsLock` 键，录音开始，松开 `CapsLock` 键，录音结束，识别结果立马被输入（录音时长短于0.3秒不算）

