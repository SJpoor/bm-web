# RAGFlow语音助手

这是一个专门为RAGFlow设计的语音智能助手界面，与原版web文件夹的界面完全相同，但使用不同的API接口来与RAGFlow服务进行交互。

## 功能特点

- **语音识别**: 实时语音转文字功能
- **智能对话**: 基于RAGFlow的知识库问答
- **流式响应**: 支持实时流式AI回复
- **会话管理**: 支持创建、管理和切换多个对话会话
- **多媒体支持**: 支持Markdown格式和代码高亮
- **思考过程**: 可选显示AI的思考过程
- **响应式设计**: 适配不同设备和屏幕尺寸

## API接口

本版本使用RAGFlow的官方API接口，支持完整的会话管理功能：

### 主要API端点

1. **聊天对话**
   ```
   POST /api/v1/chats/{chat_id}/completions
   ```

2. **会话管理**
   ```
   POST   /api/v1/chats/{chat_id}/sessions         # 创建会话
   GET    /api/v1/chats/{chat_id}/sessions         # 获取会话列表
   PUT    /api/v1/chats/{chat_id}/sessions/{id}    # 更新会话
   DELETE /api/v1/chats/{chat_id}/sessions         # 删除会话
   ```

### 聊天请求格式

```json
{
    "question": "用户消息内容",
    "stream": true,
    "session_id": "可选的会话ID",
    "user_id": "可选的用户ID"
}
```

### 会话管理请求格式

**创建会话：**
```json
{
    "name": "会话名称",
    "user_id": "可选的用户ID"
}
```

**获取会话列表：**
```
GET /api/v1/chats/{chat_id}/sessions?page=1&page_size=20&orderby=update_time&desc=true
```

### 响应格式

**聊天流式响应：**
```
data:{"code": 0, "data": {"answer": "AI回复内容片段", "session_id": "会话ID", "id": "消息ID"}}
data:{"code": 0, "data": true}
```

**会话创建响应：**
```json
{
    "code": 0,
    "data": {
        "id": "会话ID",
        "name": "会话名称",
        "chat_id": "聊天助手ID",
        "messages": [{"role": "assistant", "content": "欢迎消息"}],
        "create_time": 1728636374571,
        "update_time": 1728636374571
    }
}
```

## 配置说明

### RAGFlow服务设置

1. **API地址**: RAGFlow服务的基础URL (例如: `http://localhost:9380`)
2. **API Key**: RAGFlow的API鉴权密钥
3. **聊天ID**: 用于标识特定聊天会话的ID (例如: `voice-assistant-chat`)
4. **模型**: 模型名称，服务器会自动解析

### 语音识别设置

1. **服务地址**: 语音识别WebSocket服务地址 (例如: `ws://localhost:6016`)
2. **采样率**: 音频采样率，推荐16kHz

## 使用方法

1. **启动RAGFlow服务**: 确保RAGFlow服务正在运行并可访问
2. **配置设置**: 在设置面板中配置正确的API地址、API Key和聊天ID
3. **会话管理**: 
   - 系统在页面加载时自动初始化会话（优先使用最近会话，否则创建新会话）
   - 会话ID自动保存到本地存储，下次访问时自动恢复
   - 可在设置中手动创建、查看和切换会话
   - 支持为会话自定义名称
4. **语音交互**: 点击录音按钮开始语音识别，系统会自动将识别结果发送给RAGFlow
5. **文本交互**: 也可以直接在输入框中输入文本进行对话

## 文件结构

```
web_ragflow/
├── index.html          # 主页面文件
├── index.js            # RAGFlow API交互逻辑
├── flexible.js         # 响应式适配脚本
├── common.css          # 通用样式
├── img/                # 图片资源文件夹
└── README.md           # 说明文档
```

## 与原版的区别

### API调用差异

1. **API端点**: 使用RAGFlow官方API `/api/v1/chats/{chat_id}/completions` 而不是OpenAI兼容接口
2. **请求格式**: 使用RAGFlow原生请求格式，支持 `question`、`session_id` 等参数
3. **会话管理**: 集成完整的会话管理API，支持创建、查看、更新和删除会话
4. **聊天ID**: 需要指定特定的聊天ID来标识聊天助手
5. **认证方式**: 使用Bearer token认证

### 新增功能

1. **会话持久化**: 支持多会话管理，每个会话独立保存对话历史
2. **智能会话初始化**: 页面加载时自动获取最近会话或创建新会话
3. **会话状态保存**: 自动保存当前会话ID到本地存储，支持会话恢复
4. **会话控制**: 在设置面板中提供会话创建、列表查看、清空等功能
5. **会话状态显示**: 实时显示当前使用的会话ID

### 配置差异

1. **默认地址**: 默认API地址为 `https://192.168.40.83`
2. **会话管理**: 增加了会话ID显示、会话名称设置等选项
3. **自动化选项**: 新增自动创建会话的开关
4. **错误诊断**: 针对RAGFlow会话管理的错误信息进行了优化

## 错误排查

### 常见问题

1. **连接失败**: 
   - 检查RAGFlow服务是否正在运行
   - 确认API地址和端口是否正确
   - 检查网络连接

2. **认证错误**:
   - 验证API Key是否正确
   - 确认API Key是否有访问指定聊天的权限

3. **聊天ID错误**:
   - 确认聊天ID是否存在于RAGFlow中
   - 检查聊天ID的格式是否正确

4. **会话管理问题**:
   - 确认聊天助手是否存在且有访问权限
   - 检查会话ID格式是否正确
   - 验证会话是否属于指定的聊天助手

5. **语音识别问题**:
   - 确认语音识别服务是否正在运行
   - 检查麦克风权限
   - 验证WebSocket连接

## 开发说明

本项目基于原版语音助手进行修改，保持了相同的界面和用户体验，并集成了RAGFlow的会话管理功能。主要修改包括：

1. 更新了API调用逻辑以适配RAGFlow官方接口
2. 集成了完整的会话管理API（创建、查看、更新、删除会话）
3. 添加了会话管理用户界面和控制选项
4. 优化了错误处理和诊断信息
5. 更新了流式响应解析逻辑
6. 支持会话持久化和多会话切换

## 技术栈

- **前端**: HTML5, CSS3, JavaScript (ES6+)
- **音频处理**: Web Audio API
- **网络通信**: Fetch API, WebSocket
- **UI框架**: 原生JavaScript + CSS

## 许可证

与原项目保持一致的许可证。