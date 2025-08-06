# 使用官方 Python 3.10 镜像
FROM python:3.10

RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# 安装系统依赖和编译工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    gcc \
    g++ \
    git \
    libsndfile1 \
    libgomp1 \
    libomp-dev \
    openssl \
    vim \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制依赖文件
COPY requirements.txt .

# 安装依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制所有文件（.dockerignore中排除的文件不会被复制）
COPY . .

# 确保SSL证书文件存在，如果不存在则生成自签名证书
RUN ls -la && \
    if [ -f cert.pem ] && [ -f key.pem ]; then \
        echo "SSL证书文件已找到，将使用HTTPS连接"; \
    else \
        echo "警告：SSL证书文件不存在，生成自签名证书"; \
        openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"; \
    fi

# 给 core_server.py 和 web_server.py 脚本执行权限
RUN chmod +x core_server.py web_server.py

# 暴露端口 - 包括HTTP和HTTPS
EXPOSE 6016 8000 8443

# 启动命令 - 只启动核心服务和Web服务
CMD ["bash", "-c", "python core_server.py & python web_server.py"]