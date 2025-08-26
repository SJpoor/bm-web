// RAGFlow语音助手 - 主要逻辑文件
// 支持会话管理的API接口

class RAGFlowChat {
    constructor() {
        this.apiUrl = 'https://192.168.40.83';
        this.apiKey = 'ragflow-JiOWYyZTE0ODE1MjExZjA5ZWIxMDI0Mm';
        this.chatId = 'b446dfd4815011f087210242ac130006';
        this.sessionId = null; // 当前会话ID
        this.isStreaming = false;
        this.abortController = null;
        this.wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:6016`;
        this.audioSampleRate = 16000;
        this.showDebug = false;
        this.showThinking = false;
        
        // 语音识别相关 - 完全模仿web文件夹
        this.isRecording = false;
        this.websocket = null;
        this.audioStream = null;
        this.audioContext = null;
        this.sourceNode = null;
        this.processorNode = null;
        this.audioChunks = [];
        this.taskId = null;
        this.recordingStartTime = 0;
        this.reconnectAttempts = 0;
        this.hasFinalResult = false;
        
        // WebSocket配置 - 模仿web文件夹
        this.config = {
            serverUrl: this.wsUrl || 'ws://localhost:6016',
            sampleRate: 16000,
            segDuration: 15,
            segOverlap: 2,
            reconnectInterval: 1000,
            maxReconnectAttempts: 10,
            websocketTimeout: 5000
        };
        
        this.init();
    }

    async init() {
        // 监听设置更新事件
        document.addEventListener('settingsUpdated', (event) => {
            this.updateSettings(event.detail);
        });

        // 从localStorage加载设置
        this.loadSettings();

        // 绑定事件监听器
        this.bindEvents();

        console.log('✅ RAGFlow聊天助手已初始化');

        // 自动获取或创建会话
        await this.initializeSession();
        
        // 测试WebSocket连接
        try {
            await this.testWebSocketConnection();
        } catch (error) {
            console.warn('⚠️ WebSocket连接测试失败，语音功能可能不可用');
        }
    }

    loadSettings() {
        try {
            const savedSettings = localStorage.getItem('ragflow_voice_assistant_settings');
            if (savedSettings) {
                const allSettings = JSON.parse(savedSettings);
                
                // 只保留需要的设置字段，过滤掉旧的不需要的字段
                const settings = {
                    apiUrl: allSettings.apiUrl,
                    apiKey: allSettings.apiKey,
                    chatId: allSettings.chatId,
                    wsUrl: allSettings.wsUrl,
                    audioSampleRate: allSettings.audioSampleRate,
                    showDebug: allSettings.showDebug,
                    showThinking: allSettings.showThinking
                };
                
                this.updateSettings(settings);
                console.log('✅ 设置已加载:', settings);
                
                // 更新localStorage，移除不需要的字段
                localStorage.setItem('ragflow_voice_assistant_settings', JSON.stringify(settings));
            }
        } catch (error) {
            console.error('❌ 加载设置失败:', error);
        }
    }

    updateSettings(settings) {
        if (settings.apiUrl) this.apiUrl = settings.apiUrl;
        if (settings.apiKey) this.apiKey = settings.apiKey;
        if (settings.chatId) this.chatId = settings.chatId;
        if (settings.wsUrl) this.wsUrl = settings.wsUrl;
        if (settings.audioSampleRate) this.audioSampleRate = parseInt(settings.audioSampleRate);
        if (settings.showDebug !== undefined) this.showDebug = settings.showDebug;
        if (settings.showThinking !== undefined) this.showThinking = settings.showThinking;
        
        console.log('⚙️ 设置已更新:', {
            apiUrl: this.apiUrl,
            chatId: this.chatId,
            wsUrl: this.wsUrl,
            audioSampleRate: this.audioSampleRate
        });
    }

    bindEvents() {
        // 发送消息按钮
        document.getElementById('sendToModelBtn')?.addEventListener('click', () => {
            this.sendMessage();
        });

        // 录音按钮
        document.getElementById('recordBtn')?.addEventListener('click', () => {
            this.toggleRecording();
        });

        // 中断按钮
        document.getElementById('abortBtn')?.addEventListener('click', () => {
            this.abortRequest();
        });

        // 输入框回车键发送
        document.getElementById('inputBox')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
    }

    // 自动初始化会话
    async initializeSession() {
        try {
            // 显示初始化状态
            this.updateStatus('正在初始化会话...', 'thinking');
            this.showMessage('system', '正在初始化会话，请稍候...');

            // 首先尝试从localStorage获取保存的会话ID
            const savedSessionId = this.getSavedSessionId();
            if (savedSessionId) {
                // 验证保存的会话ID是否仍然有效
                const isValid = await this.validateSession(savedSessionId);
                if (isValid) {
                    this.sessionId = savedSessionId;
                    console.log('✅ 使用保存的会话ID:', savedSessionId);
                    this.showMessage('system', `已恢复会话: ${savedSessionId.substring(0, 8)}...`);
                    this.updateStatus('准备就绪', 'ready');
                    return;
                }
            }

            // 尝试获取最近的会话
            const recentSession = await this.getRecentSession();
            if (recentSession) {
                this.sessionId = recentSession.id;
                this.saveSessionId(this.sessionId);
                console.log('✅ 使用最近的会话:', recentSession);
                this.showMessage('system', `已连接到会话: ${recentSession.name}`);
                this.updateStatus('准备就绪', 'ready');
                return;
            }

            // 如果没有现有会话，创建新会话
            const newSession = await this.createSession(`会话 ${new Date().toLocaleString()}`);
            if (newSession) {
                this.sessionId = newSession.id;
                this.saveSessionId(this.sessionId);
                console.log('✅ 创建新会话成功:', newSession);
                this.showMessage('system', `已创建新会话: ${newSession.name}`);
                this.updateStatus('准备就绪', 'ready');
            }

        } catch (error) {
            console.error('❌ 初始化会话失败:', error);
            this.showMessage('error', `会话初始化失败: ${error.message}`);
            this.updateStatus('初始化失败', 'error');
        }
    }

    // 获取保存的会话ID
    getSavedSessionId() {
        try {
            return localStorage.getItem('ragflow_current_session_id');
        } catch (error) {
            console.error('获取保存的会话ID失败:', error);
            return null;
        }
    }

    // 保存会话ID
    saveSessionId(sessionId) {
        try {
            localStorage.setItem('ragflow_current_session_id', sessionId);
            console.log('✅ 会话ID已保存:', sessionId);
        } catch (error) {
            console.error('保存会话ID失败:', error);
        }
    }

    // 验证会话是否有效
    async validateSession(sessionId) {
        try {
            const sessions = await this.getSessions({ id: sessionId });
            return sessions && sessions.length > 0;
        } catch (error) {
            console.warn('验证会话失效:', error);
            return false;
        }
    }

    // 获取最近的会话
    async getRecentSession() {
        try {
            const sessions = await this.getSessions({
                page: 1,
                page_size: 1,
                orderby: 'update_time',
                desc: true
            });
            
            if (sessions && sessions.length > 0) {
                return sessions[0];
            }
            return null;
        } catch (error) {
            console.warn('获取最近会话失败:', error);
            return null;
        }
    }

    // 会话管理API函数

    /**
     * 创建新会话
     * @param {string} sessionName - 会话名称
     * @param {string} userId - 可选的用户ID
     * @returns {Promise<Object>} 会话信息
     */
    async createSession(sessionName = '新会话', userId = null) {
        try {
            const url = `${this.apiUrl}/api/v1/chats/${this.chatId}/sessions`;
            const body = { name: sessionName };
            if (userId) body.user_id = userId;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            if (result.code === 0) {
                this.sessionId = result.data.id;
                console.log('✅ 会话创建成功:', result.data);
                this.showMessage('system', `会话创建成功：${result.data.name}`);
                return result.data;
            } else {
                throw new Error(result.message || '创建会话失败');
            }
        } catch (error) {
            console.error('❌ 创建会话失败:', error);
            this.showMessage('error', `创建会话失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取会话列表
     * @param {Object} options - 查询选项
     * @returns {Promise<Array>} 会话列表
     */
    async getSessions(options = {}) {
        try {
            const params = new URLSearchParams();
            if (options.page) params.append('page', options.page);
            if (options.page_size) params.append('page_size', options.page_size);
            if (options.orderby) params.append('orderby', options.orderby);
            if (options.desc !== undefined) params.append('desc', options.desc);
            if (options.name) params.append('name', options.name);
            if (options.id) params.append('id', options.id);
            if (options.user_id) params.append('user_id', options.user_id);

            const url = `${this.apiUrl}/api/v1/chats/${this.chatId}/sessions?${params.toString()}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            if (result.code === 0) {
                console.log('✅ 获取会话列表成功:', result.data);
                return result.data;
            } else {
                throw new Error(result.message || '获取会话列表失败');
            }
        } catch (error) {
            console.error('❌ 获取会话列表失败:', error);
            this.showMessage('error', `获取会话列表失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 更新会话信息
     * @param {string} sessionId - 会话ID
     * @param {string} sessionName - 新的会话名称
     * @param {string} userId - 可选的用户ID
     * @returns {Promise<Object>} 更新结果
     */
    async updateSession(sessionId, sessionName, userId = null) {
        try {
            const url = `${this.apiUrl}/api/v1/chats/${this.chatId}/sessions/${sessionId}`;
            const body = { name: sessionName };
            if (userId) body.user_id = userId;

            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            if (result.code === 0) {
                console.log('✅ 会话更新成功');
                this.showMessage('system', '会话更新成功');
                return result;
            } else {
                throw new Error(result.message || '更新会话失败');
            }
        } catch (error) {
            console.error('❌ 更新会话失败:', error);
            this.showMessage('error', `更新会话失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 删除会话
     * @param {Array<string>} sessionIds - 要删除的会话ID数组
     * @returns {Promise<Object>} 删除结果
     */
    async deleteSessions(sessionIds) {
        try {
            const url = `${this.apiUrl}/api/v1/chats/${this.chatId}/sessions`;

            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({ ids: sessionIds })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            if (result.code === 0) {
                console.log('✅ 会话删除成功');
                this.showMessage('system', '会话删除成功');
                // 如果删除的是当前会话，清空sessionId
                if (sessionIds.includes(this.sessionId)) {
                    this.sessionId = null;
                }
                return result;
            } else {
                throw new Error(result.message || '删除会话失败');
            }
        } catch (error) {
            console.error('❌ 删除会话失败:', error);
            this.showMessage('error', `删除会话失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 发送消息到RAGFlow
     * @param {string} message - 用户消息
     * @param {string} sessionId - 可选的会话ID
     */
    async sendMessageToRAGFlow(message, sessionId = null) {
        if (this.isStreaming) {
            this.showMessage('error', '正在处理中，请等待...');
            return;
        }

        // 检查是否有可用的会话ID
        const currentSessionId = sessionId || this.sessionId;
        if (!currentSessionId) {
            this.showMessage('error', '会话未初始化，请稍候重试');
            console.error('❌ 无可用的会话ID');
            return;
        }

        try {
            this.isStreaming = true;
            this.abortController = new AbortController();
            
            // 显示中断按钮
            const abortBtn = document.getElementById('abortBtn');
            if (abortBtn) {
                abortBtn.style.display = 'inline-block';
            }

            // 状态已在sendMessage中设置，这里不重复设置

            // 构建请求体
            const requestBody = {
                question: message,
                stream: true,
                session_id: currentSessionId
            };

            const url = `${this.apiUrl}/api/v1/chats/${this.chatId}/completions`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(requestBody),
                signal: this.abortController.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // 处理流式响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let aiResponse = '';
            let messageElement = null;
            let thinkingElement = null;
            let isInThinkingMode = false;
            let thinkingContent = '';
            let hasReceivedFirstResponse = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 保留不完整的行

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const data = line.slice(5).trim();
                        if (data === '') continue;
                        if (data === '[DONE]') break;

                        try {
                            const chunk = JSON.parse(data);
                            
                            if (chunk.code === 0 && chunk.data) {
                                // 处理回复内容
                                if (chunk.data.answer) {
                                    // 收到第一个响应时，处理思考占位符
                                    if (!hasReceivedFirstResponse) {
                                        hasReceivedFirstResponse = true;
                                        // 查找思考占位符并使用它作为messageElement
                                        const chatContainer = document.getElementById('chatContainer');
                                        if (chatContainer) {
                                            const thinkingPlaceholder = chatContainer.querySelector('.thinking-placeholder');
                                            if (thinkingPlaceholder) {
                                                messageElement = thinkingPlaceholder.closest('.message-assistant');
                                                // 清除占位符样式和内容
                                                thinkingPlaceholder.classList.remove('thinking-placeholder');
                                                thinkingPlaceholder.textContent = '';
                                            }
                                        }
                                    }
                                    
                                    if (!messageElement) {
                                        messageElement = this.createAIMessage();
                                    }
                                    
                                    aiResponse = chunk.data.answer;
                                    
                                    // 实时处理思考标签
                                    const processedData = this.processStreamingThinking(aiResponse, messageElement);
                                    if (processedData.hasThinking) {
                                        this.updateThinkingDisplay(messageElement, processedData.thinking);
                                    }
                                    this.updateAnswerDisplay(messageElement, processedData.answer);
                                }

                                // 如果数据为true，表示流结束
                                if (chunk.data === true) {
                                    // 更新思考标签为完成状态
                                    if (messageElement && this.showThinking) {
                                        const thinkingLabel = messageElement.querySelector('.thinking-label');
                                        if (thinkingLabel) {
                                            thinkingLabel.textContent = '💭 思考完成';
                                        }
                                    }
                                    break;
                                }
                            }
                        } catch (parseError) {
                            console.warn('解析JSON失败:', parseError, 'data:', data);
                        }
                    }
                }
            }

            this.updateStatus('准备就绪', 'ready');
            
        } catch (error) {
            if (error.name === 'AbortError') {
                this.showMessage('system', '请求已中断');
                this.updateStatus('已中断', 'aborted');
            } else {
                console.error('❌ 发送消息失败:', error);
                this.showMessage('error', `发送失败: ${error.message}`);
                this.updateStatus('发送失败', 'error');
            }
        } finally {
            this.isStreaming = false;
            this.abortController = null;
            
            // 隐藏中断按钮
            const abortBtn = document.getElementById('abortBtn');
            if (abortBtn) {
                abortBtn.style.display = 'none';
            }
        }
    }

    // 发送消息（主入口函数）
    async sendMessage() {
        const inputBox = document.getElementById('inputBox');
        const message = inputBox?.textContent?.trim();

        if (!message) {
            this.showMessage('error', '请输入消息内容');
            return;
        }

        // 显示用户消息
        this.showMessage('user', message);
        
        // 清空输入框
        if (inputBox) {
            inputBox.textContent = '';
            inputBox.dispatchEvent(new Event('input')); // 触发placeholder更新
        }

        // 立即显示"正在思考"状态
        this.updateStatus('正在思考中...', 'thinking');
        
        // 创建AI助手的思考消息
        const thinkingMessage = this.createAIMessage();
        const contentDiv = thinkingMessage.querySelector('.message-content');
        if (contentDiv) {
            contentDiv.textContent = '🤔 正在思考中，请稍候...';
            contentDiv.classList.add('thinking-placeholder');
        }

        // 发送到RAGFlow
        await this.sendMessageToRAGFlow(message);
    }

    // 中断请求
    abortRequest() {
        if (this.abortController) {
            this.abortController.abort();
            console.log('🛑 请求已中断');
        }
    }

    // 显示消息
    showMessage(role, content, isMarkdown = false) {
        const chatContainer = document.getElementById('chatContainer');
        if (!chatContainer) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${role}`;

        const metaDiv = document.createElement('div');
        metaDiv.className = 'message-meta';
        
        const roleNames = {
            'user': '用户',
            'assistant': 'AI助手',
            'system': '系统',
            'error': '错误'
        };
        
        metaDiv.textContent = roleNames[role] || role;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // 对于用户消息，也应用think标签和markdown处理
        if (role === 'user' || isMarkdown) {
            const processedContent = this.processThinkTagsAndMarkdown(content);
            contentDiv.innerHTML = processedContent;
        } else {
            contentDiv.textContent = content;
        }

        messageDiv.appendChild(metaDiv);
        messageDiv.appendChild(contentDiv);
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        return messageDiv;
    }

    // 创建AI消息元素
    createAIMessage() {
        const chatContainer = document.getElementById('chatContainer');
        if (!chatContainer) return null;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message message-assistant';

        const metaDiv = document.createElement('div');
        metaDiv.className = 'message-meta';
        metaDiv.textContent = 'AI助手';

        // 创建思考容器
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'thinking-container';
        thinkingDiv.style.display = 'none';
        
        const thinkingLabel = document.createElement('div');
        thinkingLabel.className = 'thinking-label';
        thinkingLabel.textContent = '💭 思考中...';
        
        const thinkingContent = document.createElement('div');
        thinkingContent.className = 'thinking-content';
        
        thinkingDiv.appendChild(thinkingLabel);
        thinkingDiv.appendChild(thinkingContent);

        // 创建答案容器
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = '';

        messageDiv.appendChild(metaDiv);
        messageDiv.appendChild(thinkingDiv);
        messageDiv.appendChild(contentDiv);
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        return messageDiv;
    }

    // 更新AI消息内容
    updateAIMessage(messageElement, content) {
        if (!messageElement) return;
        
        const contentDiv = messageElement.querySelector('.message-content');
        if (contentDiv) {
            // 处理think标签和markdown格式
            const processedContent = this.processThinkTagsAndMarkdown(content);
            contentDiv.innerHTML = processedContent;
            
            // 自动滚动到底部
            const chatContainer = document.getElementById('chatContainer');
            if (chatContainer) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }
    }

    // 处理流式思考内容
    processStreamingThinking(content, messageElement) {
        if (!content) return { hasThinking: false, thinking: '', answer: '' };
        
        // 查找think标签
        const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
        let thinking = '';
        let answer = content;
        let hasThinking = false;
        
        // 提取所有think内容
        let match;
        while ((match = thinkRegex.exec(content)) !== null) {
            thinking += match[1];
            hasThinking = true;
        }
        
        // 移除think标签，保留答案内容
        answer = content.replace(thinkRegex, '');
        
        // 处理ID标签
        thinking = thinking.replace(/\[ID:\d+\]/gi, '').replace(/\[ID:[^\]]*\]/gi, '');
        answer = answer.replace(/\[ID:\d+\]/gi, '').replace(/\[ID:[^\]]*\]/gi, '');
        
        return {
            hasThinking,
            thinking: thinking.trim(),
            answer: answer.trim()
        };
    }

    // 更新思考内容显示
    updateThinkingDisplay(messageElement, thinkingContent) {
        if (!messageElement || !thinkingContent) return;
        
        const thinkingContainer = messageElement.querySelector('.thinking-container');
        const thinkingContentDiv = messageElement.querySelector('.thinking-content');
        
        if (thinkingContainer && thinkingContentDiv) {
            if (this.showThinking) {
                // 开关打开时显示思考内容
                thinkingContainer.style.display = 'block';
                thinkingContentDiv.textContent = thinkingContent;
            } else {
                // 开关关闭时隐藏思考内容
                thinkingContainer.style.display = 'none';
            }
            
            // 自动滚动到底部
            const chatContainer = document.getElementById('chatContainer');
            if (chatContainer) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }
    }

    // 更新答案内容显示
    updateAnswerDisplay(messageElement, answerContent) {
        if (!messageElement) return;
        
        const contentDiv = messageElement.querySelector('.message-content');
        if (contentDiv && answerContent) {
            // 处理markdown格式
            if (typeof marked !== 'undefined') {
                try {
                    marked.setOptions({
                        breaks: true,
                        gfm: true,
                        headerIds: false,
                        mangle: false
                    });
                    
                    contentDiv.innerHTML = marked.parse(answerContent);
                } catch (error) {
                    console.warn('Markdown解析失败:', error);
                    contentDiv.innerHTML = answerContent.replace(/\n/g, '<br>');
                }
            } else {
                contentDiv.innerHTML = answerContent.replace(/\n/g, '<br>');
            }
            
            // 自动滚动到底部
            const chatContainer = document.getElementById('chatContainer');
            if (chatContainer) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }
    }

    // 处理think标签和markdown格式
    processThinkTagsAndMarkdown(content) {
        if (!content) return '';
        
        // 处理think标签
        let processedContent = content;
        
        // 匹配<think>...</think>标签
        const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
        const thinkMatches = content.match(thinkRegex);
        
        if (thinkMatches && this.showThinking) {
            // 如果开启显示思考内容，将think标签转换为思考块
            processedContent = processedContent.replace(thinkRegex, (match, thinkContent) => {
                return `\n\n💭 **思考过程：**\n\`\`\`\n${thinkContent.trim()}\n\`\`\`\n\n`;
            });
        } else {
            // 如果不显示思考内容，直接移除think标签
            processedContent = processedContent.replace(thinkRegex, '');
        }
        
        // 处理[ID:数字]类型的标签，直接移除
        processedContent = processedContent.replace(/\[ID:\d+\]/gi, '');
        
        // 处理更通用的ID标签格式，如[ID:任意内容]
        processedContent = processedContent.replace(/\[ID:[^\]]*\]/gi, '');
        
        // 清理多余的空行和空格
        processedContent = processedContent.replace(/\n{3,}/g, '\n\n').trim();
        
        // 处理markdown格式
        if (typeof marked !== 'undefined') {
            try {
                // 配置marked选项
                marked.setOptions({
                    breaks: true,
                    gfm: true,
                    headerIds: false,
                    mangle: false
                });
                
                return marked.parse(processedContent);
            } catch (error) {
                console.warn('Markdown解析失败:', error);
                // 如果markdown解析失败，返回纯文本（保留换行）
                return processedContent.replace(/\n/g, '<br>');
            }
        } else {
            // 如果没有marked库，简单处理换行
            return processedContent.replace(/\n/g, '<br>');
        }
    }

    // 更新状态指示器
    updateStatus(text, status = 'ready') {
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = text;
            statusElement.className = `status-indicator ${status}`;
        }
    }

    // 语音识别相关方法
    async toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    // 测试WebSocket连接 - 完全模仿web文件夹
    async testWebSocketConnection(showMessages = false) {
        try {
            if (!this.wsUrl) {
                const error = '语音服务地址未配置，请在设置中配置WebSocket地址';
                console.error('❌', error);
                this.updateStatus('配置错误', 'error');
                if (showMessages) {
                    this.showMessage('error', error);
                }
                throw new Error(error);
            }
            
            this.updateStatus('测试语音服务连接...', 'thinking');
            console.log('🔍 测试WebSocket连接:', this.wsUrl);
            
            const testWs = new WebSocket(this.wsUrl, ["binary"]);
            
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    testWs.close();
                    reject(new Error('连接超时'));
                }, 5000);
                
                testWs.onopen = () => {
                    console.log('✅ WebSocket测试连接成功');
                    clearTimeout(timeout);
                    testWs.close();
                    this.updateStatus('准备就绪', 'ready');
                    if (showMessages) {
                        this.showMessage('system', '语音识别服务连接正常');
                    }
                    resolve(true);
                };
                
                testWs.onerror = (error) => {
                    console.error('❌ WebSocket测试连接失败:', error);
                    clearTimeout(timeout);
                    this.updateStatus('连接失败', 'error');
                    if (showMessages) {
                        this.showMessage('error', `语音识别服务连接失败: ${this.wsUrl}`);
                    }
                    reject(error);
                };
            });
        } catch (error) {
            console.error('❌ 测试WebSocket连接异常:', error);
            this.updateStatus('连接异常', 'error');
            if (showMessages) {
                this.showMessage('error', `连接测试失败: ${error.message}`);
            }
            throw error;
        }
    }

    // 连接WebSocket - 完全模仿web文件夹
    connectWebSocket() {
        return new Promise((resolve, reject) => {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                resolve(this.websocket);
                return;
            }
            
            // 如果已经有连接但不是OPEN状态，先关闭它
            if (this.websocket) {
                try {
                    this.websocket.close();
                } catch (e) {
                    console.error('关闭旧WebSocket连接失败:', e);
                }
            }
            
            // 更新config.serverUrl
            this.config.serverUrl = this.wsUrl;
            
            // 添加WebSocket连接超时处理
            let connectionTimeout = setTimeout(() => {
                if (this.websocket && this.websocket.readyState !== WebSocket.OPEN) {
                    console.error(`WebSocket连接超时 (${this.config.websocketTimeout}ms)`);
                    this.websocket.close();
                    reject(new Error('WebSocket连接超时'));
                }
            }, this.config.websocketTimeout);
            
            this.websocket = new WebSocket(this.config.serverUrl, ["binary"]);
            console.log('🔗 正在连接WebSocket:', this.config.serverUrl);
            console.log('🔧 当前配置:', {
                serverUrl: this.config.serverUrl,
                sampleRate: this.config.sampleRate,
                segDuration: this.config.segDuration,
                segOverlap: this.config.segOverlap
            });
            
            this.websocket.onopen = () => {
                clearTimeout(connectionTimeout);
                this.updateStatus('已连接到语音识别服务', 'ready');
                console.log('WebSocket连接成功');
                this.reconnectAttempts = 0;
                resolve(this.websocket);
            };
            
            this.websocket.onerror = (error) => {
                clearTimeout(connectionTimeout);
                let errorMessage = '连接语音识别服务失败';
                
                // 提供更详细的错误诊断信息
                const wsUrl = this.config.serverUrl;
                const diagnosticInfo = `\n\n🔧 语音识别服务诊断:\n• 请确保语音识别服务正在运行\n• 检查WebSocket地址: ${wsUrl}\n• 确保端口6016未被占用\n• 尝试重启语音识别服务`;
                
                this.updateStatus(errorMessage, 'error');
                this.showMessage('error', errorMessage + diagnosticInfo);
                console.error('WebSocket错误:', error);
                console.error('WebSocket URL:', wsUrl);
                reject(error);
            };
            
            this.websocket.onclose = (event) => {
                this.updateStatus('与语音识别服务的连接已关闭', 'ready');
                console.log('WebSocket关闭:', event.code, event.reason);
                
                // 如果正在录音，尝试重连
                if (this.isRecording && this.reconnectAttempts < this.config.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    this.updateStatus(`正在尝试重新连接 (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})...`, 'thinking');
                    console.log(`尝试重连 #${this.reconnectAttempts}`);
                    
                    setTimeout(() => {
                        this.connectWebSocket()
                            .then(() => {
                                this.updateStatus('重新连接成功，继续录音', 'ready');
                                console.log('重新连接成功');
                            })
                            .catch((error) => {
                                console.error(`重连失败:`, error.message || '未知错误');
                                if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
                                    this.updateStatus('重连失败，已停止录音', 'error');
                                    console.error('达到最大重连次数，停止录音');
                                    this.stopRecording();
                                }
                            });
                    }, this.config.reconnectInterval);
                } else if (!this.isRecording) {
                    console.log('WebSocket关闭，但未在录音，不尝试重连');
                } else {
                    console.error('达到最大重连次数，停止录音');
                    this.stopRecording();
                }
            };
            
            this.websocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    console.log('📨 收到WebSocket消息:', message);
                    if (message.text) {
                        if (message.is_final) {
                            const recognizedText = message.text;
                            console.log('🎯 最终识别结果:', recognizedText);
                            
                            // 更新输入框
                            const inputBox = document.getElementById('inputBox');
                            if (inputBox) {
                                inputBox.textContent = recognizedText;
                                inputBox.dispatchEvent(new Event('input'));
                            }
                            
                            this.hasFinalResult = true;
                            
                            // 语音识别完成后自动发送到聊天模型
                            setTimeout(() => {
                                this.sendMessage();
                            }, 500);
                            
                            this.updateStatus(`识别完成，用时：${(message.time_complete - message.time_submit).toFixed(2)}秒`, 'ready');
                        } else {
                            console.log('🔄 中间识别结果:', message.text);
                            // 可以添加实时显示中间结果的逻辑
                            this.updateStatus('正在识别...', 'thinking');
                            
                            // 更新输入框显示中间结果
                            const inputBox = document.getElementById('inputBox');
                            if (inputBox) {
                                inputBox.textContent = message.text;
                                inputBox.dispatchEvent(new Event('input'));
                            }
                        }
                    } else {
                        console.log('📨 收到非文本消息:', message);
                    }
                } catch (error) {
                    console.error('❌ 解析消息失败:', error, 'Raw data:', event.data);
                }
            };
        });
    }

    // 合并音频块
    combineAudioChunks(chunks) {
        let totalLength = 0;
        chunks.forEach(chunk => {
            totalLength += chunk.length;
        });
        
        const result = new Float32Array(totalLength);
        let offset = 0;
        
        chunks.forEach(chunk => {
            result.set(chunk, offset);
            offset += chunk.length;
        });
        
        return result;
    }

    // 重采样音频
    resampleAudio(inputBuffer, inputSampleRate, outputSampleRate) {
        if (inputSampleRate === outputSampleRate) {
            return inputBuffer;
        }
        
        const ratio = inputSampleRate / outputSampleRate;
        const outputLength = Math.floor(inputBuffer.length / ratio);
        const output = new Float32Array(outputLength);
        
        for (let i = 0; i < outputLength; i++) {
            const index = i * ratio;
            const indexFloor = Math.floor(index);
            const indexCeil = Math.min(indexFloor + 1, inputBuffer.length - 1);
            const fraction = index - indexFloor;
            
            output[i] = inputBuffer[indexFloor] * (1 - fraction) + inputBuffer[indexCeil] * fraction;
        }
        
        return output;
    }

    // 获取WebSocket状态文本
    getWebSocketStateText(state) {
        switch (state) {
            case WebSocket.CONNECTING: return 'CONNECTING(0)';
            case WebSocket.OPEN: return 'OPEN(1)';
            case WebSocket.CLOSING: return 'CLOSING(2)';
            case WebSocket.CLOSED: return 'CLOSED(3)';
            default: return `UNKNOWN(${state})`;
        }
    }

    // 发送音频数据 - 完全模仿web文件夹
    sendAudioData(audioData) {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket未连接，无法发送音频数据');
            
            // 尝试重新连接
            if (this.isRecording && this.reconnectAttempts < this.config.maxReconnectAttempts) {
                this.reconnectAttempts++;
                this.updateStatus(`WebSocket断开，正在尝试重新连接 (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})...`, 'thinking');
                
                this.connectWebSocket()
                    .then(() => {
                        this.updateStatus('重新连接成功，继续录音', 'ready');
                        // 重试发送
                        this.sendAudioData(audioData);
                    })
                    .catch(() => {
                        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
                            this.updateStatus('重连失败，已停止录音', 'error');
                            this.stopRecording();
                        }
                    });
            }
            return;
        }
        
        try {
            // 转换为Base64
            const buffer = new Float32Array(audioData);
            
            // 将Float32Array转换为Uint8Array
            const bytes = new Uint8Array(buffer.buffer);
            
            // 将Uint8Array转换为字符串
            let binaryString = '';
            for (let i = 0; i < bytes.length; i++) {
                binaryString += String.fromCharCode(bytes[i]);
            }
            
            // 转换为Base64
            const base64 = btoa(binaryString);
            
            // 构建消息
            const message = {
                task_id: this.taskId,
                seg_duration: this.config.segDuration,
                seg_overlap: this.config.segOverlap,
                is_final: false,
                time_start: this.recordingStartTime,
                time_frame: Date.now() / 1000,
                source: 'web',
                data: base64
            };
            
            // 发送消息
            console.log('📤 发送音频数据:', {
                task_id: this.taskId,
                dataSize: audioData.length,
                base64Size: base64.length,
                sampleRate: 16000  // 固定16kHz发送给语音识别服务
            });
            this.websocket.send(JSON.stringify(message));
        } catch (error) {
            console.error('发送音频数据失败:', error);
            this.updateStatus('发送音频数据失败', 'error');
            
            // 如果出现严重错误，停止录音
            if (error instanceof TypeError || error.message.includes('failed') || error.message.includes('closed')) {
                this.stopRecording();
            }
        }
    }

    // 发送结束信号 - 完全模仿web文件夹
    sendFinalMessage() {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket未连接，无法发送结束信号');
            return;
        }
        
        try {
            // 构建结束消息
            const message = {
                task_id: this.taskId,
                seg_duration: this.config.segDuration,
                seg_overlap: this.config.segOverlap,
                is_final: true,
                time_start: this.recordingStartTime,
                time_frame: Date.now() / 1000,
                source: 'web',
                data: ''
            };
            
            console.log('发送结束信号');
            
            // 发送消息
            this.websocket.send(JSON.stringify(message));
        } catch (error) {
            console.error('发送结束信号失败:', error);
            this.updateStatus('发送结束信号失败', 'error');
        }
    }

    // 合并音频块 - 完全模仿web文件夹
    combineAudioChunks(chunks) {
        let totalLength = 0;
        chunks.forEach(chunk => {
            totalLength += chunk.length;
        });
        
        const result = new Float32Array(totalLength);
        let offset = 0;
        
        chunks.forEach(chunk => {
            result.set(chunk, offset);
            offset += chunk.length;
        });
        
        return result;
    }

    // 重采样音频 - 完全模仿web文件夹
    resampleAudio(audioData, fromSampleRate, toSampleRate) {
        if (fromSampleRate === toSampleRate) {
            return audioData;
        }
        
        const ratio = fromSampleRate / toSampleRate;
        const newLength = Math.round(audioData.length / ratio);
        const result = new Float32Array(newLength);
        
        // 简单的线性插值重采样
        for (let i = 0; i < newLength; i++) {
            const pos = i * ratio;
            const leftPos = Math.floor(pos);
            const rightPos = Math.ceil(pos);
            const weight = pos - leftPos;
            
            if (rightPos >= audioData.length) {
                result[i] = audioData[leftPos];
            } else {
                result[i] = audioData[leftPos] * (1 - weight) + audioData[rightPos] * weight;
            }
        }
        
        return result;
    }

    async startRecording() {
        try {
            // 禁用按钮，防止重复点击
            const recordBtn = document.getElementById('recordBtn');
            if (recordBtn) recordBtn.disabled = true;
            
            // 生成任务ID
            this.taskId = 'web_' + Date.now();
            this.recordingStartTime = Date.now() / 1000;
            this.audioChunks = [];
            
            // 连接WebSocket
            await this.connectWebSocket();
            
            // 获取音频流
            this.audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            // 获取用户选择的麦克风采样率或使用默认值
            const selectedSampleRate = this.audioSampleRate ? parseInt(this.audioSampleRate) : 44100;
            
            // 语音识别服务固定使用16kHz，这是最佳识别效果的采样率
            const targetSampleRate = 16000;
            
            console.log('🎙️ 音频录制配置:', {
                selectedSampleRate: selectedSampleRate,
                targetSampleRate: targetSampleRate,
                configSampleRate: this.config.sampleRate,
                audioSampleRate: this.audioSampleRate
            });
            
            // 创建音频上下文
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: selectedSampleRate  // 使用用户选择的采样率
            });
            
            // 记录实际采样率（可能与请求的不同）
            console.log(`🎵 音频上下文创建成功，采样率: ${this.audioContext.sampleRate} Hz`);
            
            this.sourceNode = this.audioContext.createMediaStreamSource(this.audioStream);
            
            // 创建处理器节点
            this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
            
            // 处理音频数据
            this.processorNode.onaudioprocess = (e) => {
                if (!this.isRecording) return;
                
                const inputData = e.inputBuffer.getChannelData(0);
                
                // 将数据添加到缓冲区
                this.audioChunks.push(new Float32Array(inputData));
                
                // 如果缓冲区足够大，发送数据
                if (this.audioChunks.length >= 5) {  // 大约1秒的数据
                    const combinedData = this.combineAudioChunks(this.audioChunks);
                    this.audioChunks = [];
                    
                    // 重采样到16kHz（语音识别最佳采样率）
                    const resampledData = this.resampleAudio(combinedData, this.audioContext.sampleRate, targetSampleRate);
                    
                    // 发送音频数据
                    this.sendAudioData(resampledData);
                }
            };
            
            // 连接节点
            this.sourceNode.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);
            
            // 更新UI
            if (recordBtn) {
                recordBtn.innerHTML = '🛑';
                recordBtn.classList.add('recording');
            }
            this.isRecording = true;
            this.updateStatus('正在录音...', 'recording');
            
            // 添加调试信息
            console.log('开始录音，WebSocket已连接');
            
            // 启用按钮
            if (recordBtn) recordBtn.disabled = false;
            
        } catch (error) {
            console.error('开始录音失败:', error);
            this.updateStatus('开始录音失败: ' + error.message, 'error');
            const recordBtn = document.getElementById('recordBtn');
            if (recordBtn) recordBtn.disabled = false;
        }
    }

    // 停止录音 - 完全模仿web文件夹
    stopRecording() {
        if (!this.isRecording) return;
        
        // 禁用按钮，防止重复点击
        const recordBtn = document.getElementById('recordBtn');
        if (recordBtn) recordBtn.disabled = true;
        
        // 更新UI
        if (recordBtn) {
            recordBtn.innerHTML = '🎙️';
            recordBtn.classList.remove('recording');
        }
        this.updateStatus('处理中...', 'thinking');
        
        // 设置状态
        this.isRecording = false;
        
        // 停止音频流
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
        
        // 断开音频节点
        if (this.sourceNode && this.processorNode) {
            try {
                this.sourceNode.disconnect(this.processorNode);
                this.processorNode.disconnect(this.audioContext.destination);
            } catch (e) {
                console.error('断开音频节点失败:', e);
            }
        }
        
        // 关闭音频上下文
        if (this.audioContext && this.audioContext.state !== 'closed') {
            try {
                this.audioContext.close();
            } catch (e) {
                console.error('关闭音频上下文失败:', e);
            }
            this.audioContext = null;
        }
        
        // 如果还有剩余的音频数据，发送它们
        if (this.audioChunks.length > 0) {
            const combinedData = this.combineAudioChunks(this.audioChunks);
            const resampledData = this.resampleAudio(combinedData, 48000, this.config.sampleRate);
            this.sendAudioData(resampledData);
            this.audioChunks = [];
        }
        
        // 发送结束信号
        this.sendFinalMessage();
        
        // 启用按钮
        if (recordBtn) recordBtn.disabled = false;
    }

    // 会话管理UI辅助方法
    async newSession() {
        try {
            const sessionName = `会话 ${new Date().toLocaleString()}`;
            const session = await this.createSession(sessionName);
            if (session) {
                this.sessionId = session.id;
                this.saveSessionId(this.sessionId);
                console.log('✅ 已切换到新会话:', session.id);
            }
        } catch (error) {
            console.error('创建新会话失败:', error);
        }
    }

    async clearCurrentSession() {
        this.sessionId = null;
        localStorage.removeItem('ragflow_current_session_id');
        console.log('✅ 当前会话已清空');
        
        // 自动初始化新会话
        await this.initializeSession();
    }
}

// 全局实例
let ragflowChat = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async function() {
    try {
        ragflowChat = new RAGFlowChat();
        console.log('✅ RAGFlow语音助手已启动');
    } catch (error) {
        console.error('❌ RAGFlow语音助手启动失败:', error);
    }
});

// 导出给其他脚本使用
window.RAGFlowChat = RAGFlowChat;
window.ragflowChat = ragflowChat;