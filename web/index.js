document.addEventListener('DOMContentLoaded', () => {
    // DOM元素
    const recordBtn = document.getElementById('recordBtn');
    const clearBtn = document.getElementById('clearBtn');
    const statusElement = document.getElementById('status');
    const chatContainer = document.getElementById('chatContainer');
    const sendToModelBtn = document.getElementById('sendToModelBtn');
    const inputBox = document.getElementById('inputBox');
    const clearInputBtn = document.getElementById('clearInputBtn');
    const abortBtn = document.getElementById('abortBtn');
    const apiUrlInput = document.getElementById('modalApiUrl');
    const apiTypeSelect = document.getElementById('modalApiType');
    const modelSelectInput = document.getElementById('modalModelSelect');
    const queryModeSelect = document.getElementById('modalQueryMode');
    const systemPromptInput = document.getElementById('modalSystemPrompt');
    const showDebugCheckbox = document.getElementById('modalShowDebug');
    const showThinkingCheckbox = document.getElementById('modalShowThinking');
    const wsUrlInput = document.getElementById('modalWsUrl');
    const audioSampleRateSelect = document.getElementById('modalAudioSampleRate');
    
    // 配置
    const config = {
        serverUrl: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:6016`,  // 语音识别服务的WebSocket地址
        sampleRate: 16000,  // 采样率
        segDuration: 15,    // 分段长度
        segOverlap: 2,      // 分段重叠
        reconnectInterval: 1000,  // 重连间隔（毫秒）
        maxReconnectAttempts: 10,  // 最大重连次数
        websocketTimeout: 5000,  // WebSocket连接超时时间（毫秒）
    };
    
    // 聊天模型配置
    const chatModelConfig = {
        apiUrl: `https://${window.location.hostname}:9621/query/stream`,
        apiType: 'knowledge-retrieval', // 知识检索API
        model: 'lightrag:latest',
        temperature: 0.7,
        maxTokens: 2000,
        autoSend: true, // 固定为自动发送
        showDebug: false, // 添加调试信息显示设置
        showThinking: false, // 是否显示思考内容，默认隐藏
        corsMode: 'cors', // CORS模式
        queryMode: 'naive', // 查询模式：naive, local, global, hybrid, mix, bypass
        systemPrompt: "必须使用中文思考和回答，严格按照关键字进行检索并于知识库内容匹配，只能回答知识库中文档的内容，不是知识库的内容或者没用找到答案不回答", // 系统提示词
        // 检索参数固定配置（不可通过设置修改）
        topK: 50,
        chunkTopK: 30,
        maxEntityTokens: 10000,
        maxRelationTokens: 10000,
        maxTotalTokens: 30000,
        enableRerank: false
    };
    
    // 状态变量
    let isRecording = false;
    let isProcessing = false; // 添加全局防重复发送标志
    let audioContext = null;
    let sourceNode = null;
    let processorNode = null;
    let websocket = null;
    let recordingStartTime = 0;
    let taskId = null;
    let reconnectAttempts = 0;
    let audioStream = null;
    let audioChunks = [];
    let audioSendInterval = null;
    let lastRecognizedText = '';
    let currentController = null; // 用于存储当前请求的AbortController
    let conversationHistory = []; // 对话历史
    let lastRequestId = null; // 添加请求ID跟踪，防止重复请求
    let accumulatedContent = ''; // 累积的内容用于处理think标签
    
    // 更新状态显示
    function updateStatus(message, isError = false) {
        if (statusElement) {
            statusElement.innerHTML = message;
            statusElement.className = 'status-indicator' + (isError ? ' error' : isRecording ? ' recording' : '');
        }
        console.log(`状态: ${message}`);
    }
    
    // 简单的Markdown解析函数
    function parseMarkdown(text) {
        if (!text) return text;
        
        // 代码块处理
        text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // 标题处理
        text = text.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        text = text.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        text = text.replace(/^# (.*$)/gim, '<h1>$1</h1>');
        
        // 粗体和斜体
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
        
        // 链接
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        // 列表处理
        text = text.replace(/^\* (.*$)/gim, '<li>$1</li>');
        text = text.replace(/^- (.*$)/gim, '<li>$1</li>');
        text = text.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
        
        // 换行符
        text = text.replace(/\n/g, '<br>');
        
        return text;
    }
    
    // 处理think标签和内容格式化（流式显示）
    function processThinkContent(chunk, aiContentDiv) {
        accumulatedContent += chunk;
        
        // 处理字符串，逐步解析并输出
        let remainingContent = accumulatedContent;
        let processedLength = 0;
        
        while (remainingContent.length > 0) {
            // 查找think开始标签
            const thinkStartMatch = remainingContent.match(/<think>/);
            if (thinkStartMatch && thinkStartMatch.index === 0) {
                // 如果内容以<think>开始
                remainingContent = remainingContent.substring(7); // 移除<think>
                processedLength += 7;
                
                // 创建think容器或标记think状态
                let currentThinkDiv = aiContentDiv.querySelector('.think-content:last-child[data-streaming="true"]');
                if (!currentThinkDiv) {
                    if (chatModelConfig.showThinking) {
                        // 显示思考内容时创建可见容器
                        currentThinkDiv = document.createElement('div');
                        currentThinkDiv.className = 'think-content';
                        currentThinkDiv.setAttribute('data-streaming', 'true');
                        aiContentDiv.appendChild(currentThinkDiv);
                    } else {
                        // 隐藏思考内容时创建隐藏标记
                        currentThinkDiv = document.createElement('div');
                        currentThinkDiv.className = 'think-content';
                        currentThinkDiv.setAttribute('data-streaming', 'true');
                        currentThinkDiv.style.display = 'none'; // 隐藏
                        aiContentDiv.appendChild(currentThinkDiv);
                    }
                }
                
                // 更新思考状态为"思考中"
                const thinkingStatusDiv = aiContentDiv.querySelector('.thinking-status:not(.thinking-completed)');
                if (thinkingStatusDiv) {
                    thinkingStatusDiv.className = 'thinking-status';
                    thinkingStatusDiv.innerHTML = `
                        思考中
                        <div class="thinking-dots">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    `;
                }
                continue;
            }
            
            // 查找think结束标签
            const thinkEndMatch = remainingContent.match(/<\/think>/);
            if (thinkEndMatch && thinkEndMatch.index === 0) {
                // 如果内容以</think>开始
                remainingContent = remainingContent.substring(8); // 移除</think>
                processedLength += 8;
                
                // 结束当前think容器
                const currentThinkDiv = aiContentDiv.querySelector('.think-content:last-child[data-streaming="true"]');
                if (currentThinkDiv) {
                    currentThinkDiv.removeAttribute('data-streaming');
                }
                
                // think结束，更新思考状态为"已思考"
                const thinkingStatusDiv = aiContentDiv.querySelector('.thinking-status:not(.thinking-completed)');
                if (thinkingStatusDiv) {
                    thinkingStatusDiv.className = 'thinking-status thinking-completed';
                    thinkingStatusDiv.innerHTML = '已思考';
                }
                continue;
            }
            
            // 查找下一个标签的位置
            const nextTagMatch = remainingContent.match(/<\/?think>/);
            let contentToAdd;
            
            if (nextTagMatch) {
                // 如果找到下一个标签，提取到标签前的内容
                contentToAdd = remainingContent.substring(0, nextTagMatch.index);
                remainingContent = remainingContent.substring(nextTagMatch.index);
                processedLength += nextTagMatch.index;
            } else {
                // 如果没有更多标签，检查是否在think中
                const currentThinkDiv = aiContentDiv.querySelector('.think-content:last-child[data-streaming="true"]');
                if (currentThinkDiv) {
                    // 在think标签内，也要显示当前内容，实现流式效果
                    contentToAdd = remainingContent;
                    remainingContent = '';
                    processedLength += contentToAdd.length;
                } else {
                    // 不在think标签内，处理剩余内容
                    contentToAdd = remainingContent;
                    remainingContent = '';
                    processedLength += contentToAdd.length;
                }
            }
            
            // 添加内容到适当的容器
            if (contentToAdd) {
                // 检查是否在think标签内（无论是否显示思考内容）
                const currentThinkDiv = aiContentDiv.querySelector('.think-content:last-child[data-streaming="true"]');
                const isInThinkContent = currentThinkDiv !== null;
                
                if (isInThinkContent) {
                    // 在think标签内
                    if (chatModelConfig.showThinking) {
                        // 设置为显示思考内容，添加到think容器
                        const formattedContent = contentToAdd.replace(/\n/g, '<br>');
                        currentThinkDiv.innerHTML += formattedContent;
                        
                        // 调试信息：think内容流式添加
                        console.log('Think内容流式添加:', contentToAdd);
                    } else {
                        // 设置为隐藏思考内容，跳过不显示
                        console.log('Think内容已隐藏:', contentToAdd);
                    }
                    
                    // 无论是否显示，都保持思考状态
                    const thinkingStatusDiv = aiContentDiv.querySelector('.thinking-status:not(.thinking-completed)');
                    if (thinkingStatusDiv && contentToAdd.trim()) {
                        thinkingStatusDiv.innerHTML = `
                            思考中
                            <div class="thinking-dots">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        `;
                    }
                } else {
                    // 在think标签外，添加为普通内容
                    const markdownHtml = parseMarkdown(contentToAdd);
                    aiContentDiv.innerHTML += markdownHtml;
                    
                    // 调试信息：普通内容流式添加
                    console.log('普通内容流式添加:', contentToAdd);
                    
                    // 如果有非think内容且思考状态还未完成，更新为"已思考"
                    const thinkingStatusDiv = aiContentDiv.querySelector('.thinking-status:not(.thinking-completed)');
                    if (thinkingStatusDiv) {
                        thinkingStatusDiv.className = 'thinking-status thinking-completed';
                        thinkingStatusDiv.innerHTML = '已思考';
                    }
                }
            }
        }
        
        // 更新累积内容，移除已处理的部分
        accumulatedContent = accumulatedContent.substring(processedLength);
        
        // 滚动到底部
        if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    
    // 添加消息到聊天容器
    function addMessage(text, role) {
        if (!chatContainer) return;
        
        // 如果是AI回复，确保清理所有可能的think标签
        if (role === 'ai') {
    
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${role}`;
        
        const metaDiv = document.createElement('div');
        metaDiv.className = 'message-meta';
        
        if (role === 'user') {
            metaDiv.innerHTML = `用户`;
        } else if (role === 'ai') {
            metaDiv.innerHTML = ``;
        } else if (role === 'system') {
            metaDiv.innerHTML = `系统`;
        } else if (role === 'error') {
            metaDiv.innerHTML = `错误`;
        }
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // 处理换行符
        if (text.includes('\n')) {
            // 将文本中的换行符转换为<br>标签
            const fragments = text.split('\n');
            for (let i = 0; i < fragments.length; i++) {
                const span = document.createElement('span');
                span.textContent = fragments[i];
                contentDiv.appendChild(span);
                
                // 在每个片段后添加换行，除了最后一个
                if (i < fragments.length - 1) {
                    contentDiv.appendChild(document.createElement('br'));
                }
            }
        } else {
            contentDiv.textContent = text;
        }
        
        messageDiv.appendChild(metaDiv);
        messageDiv.appendChild(contentDiv);
        chatContainer.appendChild(messageDiv);
        
        // 保存最新的识别结果
        if (role === 'user') {
            lastRecognizedText = text;
            // 注意：不在这里自动调用API，避免重复调用
            // API调用应该在具体的输入处理逻辑中单独调用
        }
        
        // 滚动到底部
        chatContainer.scrollTop = chatContainer.scrollHeight;
        
        return messageDiv; // 返回创建的消息元素，方便后续操作
    }
    
    // 清空聊天记录
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (chatContainer) {
                chatContainer.innerHTML = `
                    <div class="message message-system">
                        <div class="message-meta">系统</div>
                        <div class="message-content">
                            对话已清空！您可以开始新的对话。
                        </div>
                    </div>
                `;
            }
            lastRecognizedText = '';
            if (inputBox) inputBox.textContent = '';
            conversationHistory = [];
        });
    }
    
    // 清空输入框
    if (clearInputBtn) {
        clearInputBtn.addEventListener('click', () => {
            if (inputBox) inputBox.textContent = '';
        });
    }
    
    // 加载设置
    function loadSettings() {
        // 从localStorage加载设置 - 使用与HTML一致的键名
        const savedSettings = localStorage.getItem('voiceAssistantSettings');
        if (savedSettings) {
            try {
                const settings = JSON.parse(savedSettings);
                chatModelConfig.apiUrl = settings.apiUrl || chatModelConfig.apiUrl;
                chatModelConfig.apiType = settings.apiType || chatModelConfig.apiType;
                chatModelConfig.model = settings.model || chatModelConfig.model;
                chatModelConfig.systemPrompt = settings.systemPrompt !== undefined ? settings.systemPrompt : chatModelConfig.systemPrompt;
                chatModelConfig.temperature = settings.temperature || chatModelConfig.temperature;
                chatModelConfig.maxTokens = settings.maxTokens || chatModelConfig.maxTokens;
                chatModelConfig.topK = settings.topK || chatModelConfig.topK;
                chatModelConfig.chunkTopK = settings.chunkTopK || chatModelConfig.chunkTopK;
                chatModelConfig.maxEntityTokens = settings.maxEntityTokens || chatModelConfig.maxEntityTokens;
                chatModelConfig.maxRelationTokens = settings.maxRelationTokens || chatModelConfig.maxRelationTokens;
                chatModelConfig.maxTotalTokens = settings.maxTotalTokens || chatModelConfig.maxTotalTokens;
                chatModelConfig.enableRerank = settings.enableRerank !== undefined ? settings.enableRerank : chatModelConfig.enableRerank;
                chatModelConfig.showDebug = settings.showDebug !== undefined ? settings.showDebug : chatModelConfig.showDebug;
                chatModelConfig.showThinking = settings.showThinking !== undefined ? settings.showThinking : chatModelConfig.showThinking;
                chatModelConfig.queryMode = settings.queryMode || chatModelConfig.queryMode;
                
                // 加载WebSocket地址设置
                if (settings.wsUrl) {
                    config.serverUrl = settings.wsUrl;
                    console.log('从设置加载WebSocket地址:', settings.wsUrl);
                    if (wsUrlInput) {
                        wsUrlInput.value = settings.wsUrl;
                    }
                }
                
                // 加载音频设置
                if (settings.audioSampleRate) {
                    config.sampleRate = parseInt(settings.audioSampleRate);
                    if (audioSampleRateSelect) {
                        audioSampleRateSelect.value = settings.audioSampleRate;
                    }
                }
                
                // 更新UI
                if (apiUrlInput) apiUrlInput.value = chatModelConfig.apiUrl;
                if (apiTypeSelect) apiTypeSelect.value = chatModelConfig.apiType;
                if (modelSelectInput) modelSelectInput.value = chatModelConfig.model;
                if (queryModeSelect) queryModeSelect.value = chatModelConfig.queryMode;
                if (systemPromptInput) systemPromptInput.value = chatModelConfig.systemPrompt;
                if (showDebugCheckbox) showDebugCheckbox.checked = chatModelConfig.showDebug;
                if (showThinkingCheckbox) showThinkingCheckbox.checked = chatModelConfig.showThinking;
            } catch (error) {
                console.error('加载设置失败:', error);
            }
        } else {
            console.log('没有找到已保存的设置，将使用默认值');
            // 如果没有保存的设置，使用默认值
            if (wsUrlInput) {
                wsUrlInput.value = config.serverUrl;
            }
            if (apiUrlInput) {
                apiUrlInput.value = chatModelConfig.apiUrl;
            }
            if (queryModeSelect) {
                queryModeSelect.value = chatModelConfig.queryMode;
            }
        }
        
        // 确保自动发送始终为true
        chatModelConfig.autoSend = true;
    }
    
    // 保存设置
    function saveSettings() {
        if (apiUrlInput) chatModelConfig.apiUrl = apiUrlInput.value;
        if (apiTypeSelect) chatModelConfig.apiType = apiTypeSelect.value;
        if (modelSelectInput) chatModelConfig.model = modelSelectInput.value;
        if (queryModeSelect) chatModelConfig.queryMode = queryModeSelect.value;
        if (systemPromptInput) chatModelConfig.systemPrompt = systemPromptInput.value;
        chatModelConfig.autoSend = true; // 固定为自动发送
        if (showDebugCheckbox) chatModelConfig.showDebug = showDebugCheckbox.checked;
        if (showThinkingCheckbox) chatModelConfig.showThinking = showThinkingCheckbox.checked;
        
        // 保存WebSocket地址设置
        if (wsUrlInput) {
            chatModelConfig.wsUrl = wsUrlInput.value;
            // 更新配置
            config.serverUrl = wsUrlInput.value;
        }
        
        // 保存音频设置
        if (audioSampleRateSelect) {
            chatModelConfig.audioSampleRate = parseInt(audioSampleRateSelect.value);
            // 注意：config.sampleRate 始终保持16000，用于语音识别服务
            // 用户选择的采样率仅用于麦克风录制，然后重采样到16kHz
        }
        
        // 保存到localStorage - 使用与HTML一致的键名
        const settingsToSave = {
            apiUrl: chatModelConfig.apiUrl,
            apiType: chatModelConfig.apiType,
            model: chatModelConfig.model,
            queryMode: chatModelConfig.queryMode,
            systemPrompt: chatModelConfig.systemPrompt,
            showDebug: chatModelConfig.showDebug,
            showThinking: chatModelConfig.showThinking,
            wsUrl: config.serverUrl,
            audioSampleRate: config.sampleRate
        };
        localStorage.setItem('voiceAssistantSettings', JSON.stringify(settingsToSave));
        
        console.log('设置已保存:', chatModelConfig);
    }
    
    // 监听设置变化
    if (apiUrlInput) apiUrlInput.addEventListener('change', saveSettings);
    if (apiTypeSelect) apiTypeSelect.addEventListener('change', saveSettings);
    if (modelSelectInput) modelSelectInput.addEventListener('change', saveSettings);
    if (systemPromptInput) systemPromptInput.addEventListener('change', saveSettings);
    if (showDebugCheckbox) {
        showDebugCheckbox.addEventListener('change', function() {
            saveSettings();
        });
    }
    if (showThinkingCheckbox) {
        showThinkingCheckbox.addEventListener('change', function() {
            saveSettings();
        });
    }
    
    // 监听WebSocket地址变化
    if (wsUrlInput) {
        wsUrlInput.addEventListener('change', function() {
            saveSettings();
            console.log('语音识别服务地址已更改为:', wsUrlInput.value);
            // 如果正在录音，提示用户需要重新连接
            if (isRecording) {
                updateStatus('服务地址已更改，请停止并重新开始录音以连接新地址', true);
            }
        });
    }
    
    // 监听音频采样率变化
    if (audioSampleRateSelect) {
        audioSampleRateSelect.addEventListener('change', function() {
            saveSettings();
            console.log('麦克风采样率已更改为:', audioSampleRateSelect.value, 'Hz');
        });
    }
    
    // 连接WebSocket
    function connectWebSocket() {
        return new Promise((resolve, reject) => {
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                resolve(websocket);
                return;
            }
            
            // 如果已经有连接但不是OPEN状态，先关闭它
            if (websocket) {
                try {
                    websocket.close();
                } catch (e) {
                    console.error('关闭旧WebSocket连接失败:', e);
                }
            }
            
            // 添加WebSocket连接超时处理
            let connectionTimeout = setTimeout(() => {
                if (websocket && websocket.readyState !== WebSocket.OPEN) {
                    console.error(`WebSocket连接超时 (${config.websocketTimeout}ms)`);
                    websocket.close();
                    reject(new Error('WebSocket连接超时'));
                }
            }, config.websocketTimeout);
            
            websocket = new WebSocket(config.serverUrl, ["binary"]);
            console.log('🔗 正在连接WebSocket:', config.serverUrl);
            console.log('🔧 当前配置:', {
                serverUrl: config.serverUrl,
                sampleRate: config.sampleRate,
                segDuration: config.segDuration,
                segOverlap: config.segOverlap
            });
            
            websocket.onopen = () => {
                clearTimeout(connectionTimeout);
                updateStatus('已连接到语音识别服务', false);
                console.log('WebSocket连接成功');
                reconnectAttempts = 0;
                resolve(websocket);
            };
            
                          websocket.onerror = (error) => {
                  clearTimeout(connectionTimeout);
                  let errorMessage = '连接语音识别服务失败';
                  
                  // 提供更详细的错误诊断信息
                  const wsUrl = config.serverUrl;
                  const diagnosticInfo = `\n\n🔧 语音识别服务诊断:\n• 请确保语音识别服务正在运行\n• 检查WebSocket地址: ${wsUrl}\n• 确保端口6016未被占用\n• 尝试重启语音识别服务`;
                  
                  updateStatus(errorMessage, true);
                  addChatMessage(errorMessage + diagnosticInfo, 'error');
                  console.error('WebSocket错误:', error);
                  console.error('WebSocket URL:', wsUrl);
                  reject(error);
              };
            
            websocket.onclose = (event) => {
                updateStatus('与语音识别服务的连接已关闭', false);
                console.log('WebSocket关闭:', event.code, event.reason);
                
                // 如果正在录音，尝试重连
                if (isRecording && reconnectAttempts < config.maxReconnectAttempts) {
                    reconnectAttempts++;
                    updateStatus(`正在尝试重新连接 (${reconnectAttempts}/${config.maxReconnectAttempts})...`, false);
                    console.log(`尝试重连 #${reconnectAttempts}`);
                    
                    setTimeout(() => {
                        connectWebSocket()
                            .then(() => {
                                updateStatus('重新连接成功，继续录音', false);
                                console.log('重新连接成功');
                            })
                            .catch((error) => {
                                console.error(`重连失败:`, error.message || '未知错误');
                                if (reconnectAttempts >= config.maxReconnectAttempts) {
                                    updateStatus('重连失败，已停止录音', true);
                                    console.error('达到最大重连次数，停止录音');
                                    stopRecording();
                                }
                            });
                    }, config.reconnectInterval);
                } else if (!isRecording) {
                    console.log('WebSocket关闭，但未在录音，不尝试重连');
                } else {
                    console.error('达到最大重连次数，停止录音');
                    stopRecording();
                }
            };
            
            websocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    console.log('📨 收到WebSocket消息:', message);
                    if (message.text) {
                        if (message.is_final) {
                            const recognizedText = message.text;
                            console.log('🎯 最终识别结果:', recognizedText);
                            addMessage(recognizedText, 'user');
                            // 语音识别完成后发送到聊天模型
                            sendToChatModelDirectly(recognizedText);
                            updateStatus(`识别完成，用时：${(message.time_complete - message.time_submit).toFixed(2)}秒`, false);
                        } else {
                            console.log('🔄 中间识别结果:', message.text);
                            // 可以添加实时显示中间结果的逻辑
                            updateStatus('正在识别...', false);
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
    
    // 开始录音
    async function startRecording() {
        try {
            // 禁用按钮，防止重复点击
            if (recordBtn) recordBtn.disabled = true;
            
            // 生成任务ID
            taskId = 'web_' + Date.now();
            recordingStartTime = Date.now() / 1000;
            audioChunks = [];
            
            // 连接WebSocket
            await connectWebSocket();
            
            // 获取音频流
            audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            // 获取用户选择的麦克风采样率或使用默认值
            const selectedSampleRate = audioSampleRateSelect ? parseInt(audioSampleRateSelect.value) : 44100;
            
            // 语音识别服务固定使用16kHz，这是最佳识别效果的采样率
            const targetSampleRate = 16000;
            
            console.log('🎙️ 音频录制配置:', {
                selectedSampleRate: selectedSampleRate,
                targetSampleRate: targetSampleRate,
                configSampleRate: config.sampleRate,
                audioSampleRateSelectValue: audioSampleRateSelect ? audioSampleRateSelect.value : 'null',
                audioSampleRateSelectElement: audioSampleRateSelect ? 'exists' : 'null'
            });
            
            // 创建音频上下文
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: selectedSampleRate  // 使用用户选择的采样率
            });
            
            // 记录实际采样率（可能与请求的不同）
            console.log(`🎵 音频上下文创建成功，采样率: ${audioContext.sampleRate} Hz`);
            
            sourceNode = audioContext.createMediaStreamSource(audioStream);
            
            // 创建处理器节点
            processorNode = audioContext.createScriptProcessor(4096, 1, 1);
            
            // 处理音频数据
            processorNode.onaudioprocess = (e) => {
                if (!isRecording) return;
                
                const inputData = e.inputBuffer.getChannelData(0);
                
                // 将数据添加到缓冲区
                audioChunks.push(new Float32Array(inputData));
                
                // 如果缓冲区足够大，发送数据
                if (audioChunks.length >= 5) {  // 大约1秒的数据
                    const combinedData = combineAudioChunks(audioChunks);
                    audioChunks = [];
                    
                    // 重采样到16kHz（语音识别最佳采样率）
                    const resampledData = resampleAudio(combinedData, audioContext.sampleRate, targetSampleRate);
                    
                    // 发送音频数据
                    sendAudioData(resampledData);
                }
            };
            
            // 连接节点
            sourceNode.connect(processorNode);
            processorNode.connect(audioContext.destination);
            
            // 更新UI
            if (recordBtn) {
                recordBtn.innerHTML = '🛑';
                recordBtn.classList.add('recording');
            }
            isRecording = true;
            updateStatus('正在录音...', false);
            
            // 添加调试信息
            console.log('开始录音，WebSocket已连接');
            
            // 启用按钮
            if (recordBtn) recordBtn.disabled = false;
            
        } catch (error) {
            console.error('开始录音失败:', error);
            updateStatus('开始录音失败: ' + error.message, true);
            if (recordBtn) recordBtn.disabled = false;
        }
    }
    
    // 停止录音
    function stopRecording() {
        if (!isRecording) return;
        
        // 禁用按钮，防止重复点击
        if (recordBtn) recordBtn.disabled = true;
        
        // 更新UI
        if (recordBtn) {
            recordBtn.innerHTML = '🎙️';
            recordBtn.classList.remove('recording');
        }
        updateStatus('处理中...', false);
        
        // 设置状态
        isRecording = false;
        
        // 停止音频流
        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
            audioStream = null;
        }
        
        // 断开音频节点
        if (sourceNode && processorNode) {
            try {
                sourceNode.disconnect(processorNode);
                processorNode.disconnect(audioContext.destination);
            } catch (e) {
                console.error('断开音频节点失败:', e);
            }
        }
        
        // 关闭音频上下文
        if (audioContext && audioContext.state !== 'closed') {
            try {
                audioContext.close();
            } catch (e) {
                console.error('关闭音频上下文失败:', e);
            }
            audioContext = null;
        }
        
        // 如果还有剩余的音频数据，发送它们
        if (audioChunks.length > 0) {
            const combinedData = combineAudioChunks(audioChunks);
            const resampledData = resampleAudio(combinedData, 48000, config.sampleRate);
            sendAudioData(resampledData);
            audioChunks = [];
        }
        
        // 发送结束信号
        sendFinalMessage();
        
        // 启用按钮
        if (recordBtn) recordBtn.disabled = false;
    }
    
    // 合并音频块
    function combineAudioChunks(chunks) {
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
    
    // 发送音频数据
    function sendAudioData(audioData) {
        if (!websocket || websocket.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket未连接，无法发送音频数据');
            
            // 尝试重新连接
            if (isRecording && reconnectAttempts < config.maxReconnectAttempts) {
                reconnectAttempts++;
                updateStatus(`WebSocket断开，正在尝试重新连接 (${reconnectAttempts}/${config.maxReconnectAttempts})...`, false);
                
                connectWebSocket()
                    .then(() => {
                        updateStatus('重新连接成功，继续录音', false);
                        // 重试发送
                        sendAudioData(audioData);
                    })
                    .catch(() => {
                        if (reconnectAttempts >= config.maxReconnectAttempts) {
                            updateStatus('重连失败，已停止录音', true);
                            stopRecording();
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
                task_id: taskId,
                seg_duration: config.segDuration,
                seg_overlap: config.segOverlap,
                is_final: false,
                time_start: recordingStartTime,
                time_frame: Date.now() / 1000,
                source: 'web',
                data: base64
            };
            
            // 发送消息
            console.log('📤 发送音频数据:', {
                task_id: taskId,
                dataSize: audioData.length,
                base64Size: base64.length,
                sampleRate: 16000  // 固定16kHz发送给语音识别服务
            });
            websocket.send(JSON.stringify(message));
        } catch (error) {
            console.error('发送音频数据失败:', error);
            updateStatus('发送音频数据失败', true);
            
            // 如果出现严重错误，停止录音
            if (error instanceof TypeError || error.message.includes('failed') || error.message.includes('closed')) {
                stopRecording();
            }
        }
    }
    
    // 发送结束信号
    function sendFinalMessage() {
        if (!websocket || websocket.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket未连接，无法发送结束信号');
            return;
        }
        
        try {
            // 构建结束消息
            const message = {
                task_id: taskId,
                seg_duration: config.segDuration,
                seg_overlap: config.segOverlap,
                is_final: true,
                time_start: recordingStartTime,
                time_frame: Date.now() / 1000,
                source: 'web',
                data: ''
            };
            
            console.log('发送结束信号');
            
            // 发送消息
            websocket.send(JSON.stringify(message));
        } catch (error) {
            console.error('发送结束信号失败:', error);
            updateStatus('发送结束信号失败', true);
        }
    }
    
    // 重采样音频
    function resampleAudio(audioData, fromSampleRate, toSampleRate) {
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
    
    // 直接发送到聊天模型（不添加用户消息，用于语音识别）
    async function sendToChatModelDirectly(text) {
        // 生成请求ID
        const requestId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // 防止重复发送
        if (isProcessing) {
            console.log('正在处理上一条消息，忽略重复请求');
            return;
        }
        
        lastRequestId = requestId;
        lastRecognizedText = text; // 更新最后识别的文本
        
        if (!text || text.trim() === '') {
            updateStatus('没有可发送的文本', true);
            return;
        }

        isProcessing = true;
        updateStatus('正在等待AI响应...', false);
        console.log(`发送文本到聊天模型: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

        let timeoutId;
        try {
            // 使用知识检索API格式
            const requestData = {
                query: text,
                mode: chatModelConfig.queryMode || "naive",
                only_need_context: false,
                only_need_prompt: false,
                response_type: "Multiple Paragraphs",
                top_k: chatModelConfig.topK,
                chunk_top_k: chatModelConfig.chunkTopK,
                max_entity_tokens: chatModelConfig.maxEntityTokens,
                max_relation_tokens: chatModelConfig.maxRelationTokens,
                max_total_tokens: chatModelConfig.maxTotalTokens,
                history_turns: 0,
                ids: [],
                user_prompt: chatModelConfig.systemPrompt || "用中文回答，只能回答知识库中文档的内容，不是知识库中文档的内容不回答",
                enable_rerank: chatModelConfig.enableRerank,
                stream: true  // 启用流式响应
            };

            console.log(`请求URL: ${chatModelConfig.apiUrl}`);
            console.log('请求数据:', requestData);
            
            currentController = new AbortController();
            const timeoutId = setTimeout(() => {
                if (currentController) {
                    currentController.abort();
                }
            }, 60000);
            if (abortBtn) abortBtn.style.display = 'block';

            const response = await fetch(chatModelConfig.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(requestData),
                credentials: "omit",
                mode: 'cors',
                signal: currentController.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error: ${response.status}, ${errorText}`);
            }

            // 重置累积内容
            accumulatedContent = '';
            
            // Create a new message container for the AI response
            const aiMessageDiv = addMessage('', 'ai');
            const aiContentDiv = aiMessageDiv ? aiMessageDiv.querySelector('.message-content') : null;
            if (aiContentDiv) aiContentDiv.innerHTML = ''; // Clear initial content

            // 添加思考状态指示器
            const thinkingStatusDiv = document.createElement('div');
            thinkingStatusDiv.className = 'thinking-status';
            thinkingStatusDiv.innerHTML = `
                思考中
                <div class="thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            `;
            if (aiContentDiv) aiContentDiv.appendChild(thinkingStatusDiv);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let partialResponse = '';
            let hasStartedStreaming = false;
            
            updateStatus('AI正在思考...', false);

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                
                partialResponse += decoder.decode(value, { stream: true });
                
                // Process each JSON object in the stream
                let newlineIndex;
                while ((newlineIndex = partialResponse.indexOf('\n')) !== -1) {
                    const line = partialResponse.slice(0, newlineIndex);
                    partialResponse = partialResponse.slice(newlineIndex + 1);

                    if (line.trim() === '') continue;

                    try {
                        const parsed = JSON.parse(line);
                        let chunk = '';
                        
                        // 支持多种API响应格式
                        if (parsed.data) { // 知识检索API流式响应格式
                            chunk = parsed.data;
                        } else if (parsed.answer) { // 另一种知识检索格式
                            chunk = parsed.answer;
                        } else if (parsed.result) { // 结果字段格式
                            chunk = parsed.result;
                        } else if (parsed.text) { // 文本字段格式
                            chunk = parsed.text;
                        } else if (parsed.response) { // Ollama generate API
                            chunk = parsed.response;
                        } else if (parsed.message && parsed.message.content) { // Ollama chat API
                            chunk = parsed.message.content;
                            if(parsed.done) { // ollama chat api done is not in chunk
                                // 流式响应结束
                            }
                        } else if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) { // OpenAI-compatible chat API
                            chunk = parsed.choices[0].delta.content;
                        } else if (parsed.content) { // 直接内容格式
                            chunk = parsed.content;
                        } else if (typeof parsed === 'string') { // 直接是字符串
                            chunk = parsed;
                        }
                        
                        // 调试信息：显示解析的响应结构
                        if (chatModelConfig.showDebug) {
                            console.log('解析的响应:', parsed);
                            console.log('提取的chunk:', chunk);
                        }
                        
                        if (chunk && aiContentDiv) {
                            // 调试：打印chunk内容
                            console.log('收到chunk:', chunk);
                            
                            // 第一次收到内容时，更新状态为正在回复
                            if (!hasStartedStreaming) {
                                hasStartedStreaming = true;
                                updateStatus('AI正在回复...', false);
                            }
                            
                            // 使用新的think标签处理和Markdown解析
                            processThinkContent(chunk, aiContentDiv);
                        }
                    } catch (e) {
                        console.error('Error parsing streaming JSON:', e, 'line:', line);
                    }
                }
            }

            // 处理最后可能剩余的内容
            if (accumulatedContent.trim() && aiContentDiv) {
                const markdownHtml = parseMarkdown(accumulatedContent);
                aiContentDiv.innerHTML += markdownHtml;
                accumulatedContent = '';
            }
            
            // 清理所有streaming状态的think容器
            if (aiContentDiv) {
                const streamingThinkDivs = aiContentDiv.querySelectorAll('.think-content[data-streaming="true"]');
                streamingThinkDivs.forEach(div => {
                    div.removeAttribute('data-streaming');
                });
            }

            updateStatus('AI响应完成', false);

        } catch (error) {
            if (error.name === 'AbortError') {
                updateStatus('请求已中断', true);
                addChatMessage('请求已被用户中断', 'system');
                      } else {
                  let errorMessage = `请求失败: ${error.message}`;
                  
                  // 提供更详细的错误诊断信息
                  if (error.message.includes('Failed to fetch') || error.message.includes('ERR_CONNECTION_REFUSED')) {
                    //   errorMessage += `\n\n🔧 连接诊断:\n• 请确保服务正在运行在端口9621\n• 检查API地址: ${chatModelConfig.apiUrl}\n• 尝试在浏览器中访问: ${chatModelConfig.apiUrl.replace('/query/stream', '')}\n• 确保端口9621未被占用`;
                  } else if (error.message.includes('SSL') || error.message.includes('certificate') || error.message.includes('HTTPS')) {
                      errorMessage += `\n\n🔧 HTTPS/SSL问题:\n• 确保您的服务支持HTTPS (SSL/TLS)\n• 如果使用自签名证书，请在浏览器中先访问: ${chatModelConfig.apiUrl.replace('/query/stream', '')}\n• 接受证书警告后再使用语音助手\n• 或在设置中将API地址改为HTTP协议`;
                  } else if (error.message.includes('404')) {
                      errorMessage += `\n\n🔧 API路径错误:\n• 请检查API地址是否正确\n• 当前地址: ${chatModelConfig.apiUrl}\n• 确保服务支持此API路径`;
                  } else if (error.message.includes('500')) {
                      errorMessage += `\n\n🔧 服务器错误:\n• 服务可能存在问题\n• 请检查模型 '${chatModelConfig.model}' 是否已安装\n• 检查服务器日志获取更多信息`;
                  }
                  
                  updateStatus(`发送到聊天模型失败: ${error.message}`, true);
                  addChatMessage(errorMessage, 'error');
              }
            console.error('sendToChatModel error:', error);
            console.error('Current config:', chatModelConfig);
        } finally {
            isProcessing = false;
            if (abortBtn) abortBtn.style.display = 'none';
            if (timeoutId) clearTimeout(timeoutId);
            currentController = null;
        }
    }

    // 发送到聊天模型
    async function sendToChatModel(text) {
        // 生成请求ID
        const requestId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // 防止重复发送
        if (isProcessing) {
            console.log('正在处理上一条消息，忽略重复请求');
            return;
        }
        
        lastRequestId = requestId;
        lastRecognizedText = text; // 更新最后识别的文本
        
        if (!text || text.trim() === '') {
            if (inputBox && inputBox.textContent.trim() !== '') {
                text = inputBox.textContent.trim();
            } else {
                updateStatus('没有可发送的文本', true);
                return;
            }
        }
        
        // 始终添加用户消息（即使是重复的问题也显示独立的对话框）
        if (inputBox && text === inputBox.textContent.trim()) {
            addChatMessage(text, 'user');
            inputBox.textContent = '';
            inputBox.focus();
        } else {
            addChatMessage(text, 'user');
        }

        isProcessing = true;
        updateStatus('正在等待AI响应...', false);
        console.log(`发送文本到聊天模型: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

        let timeoutId;
        try {
            // 使用知识检索API格式
            const requestData = {
                query: text,
                mode: chatModelConfig.queryMode || "naive",
                only_need_context: false,
                only_need_prompt: false,
                response_type: "Multiple Paragraphs",
                top_k: chatModelConfig.topK,
                chunk_top_k: chatModelConfig.chunkTopK,
                max_entity_tokens: chatModelConfig.maxEntityTokens,
                max_relation_tokens: chatModelConfig.maxRelationTokens,
                max_total_tokens: chatModelConfig.maxTotalTokens,
                history_turns: 0,
                ids: [],
                user_prompt: chatModelConfig.systemPrompt || "用中文回答，只能回答知识库中文档的内容，不是知识库中文档的内容不回答",
                enable_rerank: chatModelConfig.enableRerank,
                stream: true  // 启用流式响应
            };

            console.log(`请求URL: ${chatModelConfig.apiUrl}`);
            console.log('请求数据:', requestData);
            
            currentController = new AbortController();
            const timeoutId = setTimeout(() => {
                if (currentController) {
                    currentController.abort();
                }
            }, 60000);
            if (abortBtn) abortBtn.style.display = 'block';

            const response = await fetch(chatModelConfig.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(requestData),
                credentials: "omit",
                mode: 'cors',
                signal: currentController.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error: ${response.status}, ${errorText}`);
            }

            // 重置累积内容
            accumulatedContent = '';
            
            // Create a new message container for the AI response
            const aiMessageDiv = addMessage('', 'ai');
            const aiContentDiv = aiMessageDiv ? aiMessageDiv.querySelector('.message-content') : null;
            if (aiContentDiv) aiContentDiv.innerHTML = ''; // Clear initial content

            // 添加思考状态指示器
            const thinkingStatusDiv = document.createElement('div');
            thinkingStatusDiv.className = 'thinking-status';
            thinkingStatusDiv.innerHTML = `
                思考中
                <div class="thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            `;
            if (aiContentDiv) aiContentDiv.appendChild(thinkingStatusDiv);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let partialResponse = '';
            let hasStartedStreaming = false;
            
            updateStatus('AI正在思考...', false);

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                
                partialResponse += decoder.decode(value, { stream: true });
                
                // Process each JSON object in the stream
                let newlineIndex;
                while ((newlineIndex = partialResponse.indexOf('\n')) !== -1) {
                    const line = partialResponse.slice(0, newlineIndex);
                    partialResponse = partialResponse.slice(newlineIndex + 1);

                    if (line.trim() === '') continue;

                    try {
                        const parsed = JSON.parse(line);
                        let chunk = '';
                        
                        // 支持多种API响应格式
                        if (parsed.data) { // 知识检索API流式响应格式
                            chunk = parsed.data;
                        } else if (parsed.answer) { // 另一种知识检索格式
                            chunk = parsed.answer;
                        } else if (parsed.result) { // 结果字段格式
                            chunk = parsed.result;
                        } else if (parsed.text) { // 文本字段格式
                            chunk = parsed.text;
                        } else if (parsed.response) { // Ollama generate API
                            chunk = parsed.response;
                        } else if (parsed.message && parsed.message.content) { // Ollama chat API
                            chunk = parsed.message.content;
                            if(parsed.done) { // ollama chat api done is not in chunk
                                // 流式响应结束
                            }
                        } else if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) { // OpenAI-compatible chat API
                            chunk = parsed.choices[0].delta.content;
                        } else if (parsed.content) { // 直接内容格式
                            chunk = parsed.content;
                        } else if (typeof parsed === 'string') { // 直接是字符串
                            chunk = parsed;
                        }
                        
                        // 调试信息：显示解析的响应结构
                        if (chatModelConfig.showDebug) {
                            console.log('解析的响应:', parsed);
                            console.log('提取的chunk:', chunk);
                        }
                        
                        if (chunk && aiContentDiv) {
                            // 调试：打印chunk内容
                            console.log('收到chunk:', chunk);
                            
                            // 第一次收到内容时，更新状态为正在回复
                            if (!hasStartedStreaming) {
                                hasStartedStreaming = true;
                                updateStatus('AI正在回复...', false);
                            }
                            
                            // 使用新的think标签处理和Markdown解析
                            processThinkContent(chunk, aiContentDiv);
                        }
                    } catch (e) {
                        console.error('Error parsing streaming JSON:', e, 'line:', line);
                    }
                }
            }

            // 处理最后可能剩余的内容
            if (accumulatedContent.trim() && aiContentDiv) {
                const markdownHtml = parseMarkdown(accumulatedContent);
                aiContentDiv.innerHTML += markdownHtml;
                accumulatedContent = '';
            }
            
            // 清理所有streaming状态的think容器
            if (aiContentDiv) {
                const streamingThinkDivs = aiContentDiv.querySelectorAll('.think-content[data-streaming="true"]');
                streamingThinkDivs.forEach(div => {
                    div.removeAttribute('data-streaming');
                });
            }

            updateStatus('AI响应完成', false);

        } catch (error) {
            if (error.name === 'AbortError') {
                updateStatus('请求已中断', true);
                addChatMessage('请求已被用户中断', 'system');
                          } else {
                  let errorMessage = `请求失败: ${error.message}`;
                  
                  // 提供更详细的错误诊断信息
                  if (error.message.includes('Failed to fetch') || error.message.includes('ERR_CONNECTION_REFUSED')) {
                    //   errorMessage += `\n\n🔧 连接诊断:\n• 请确保服务正在运行在端口9621\n• 检查API地址: ${chatModelConfig.apiUrl}\n• 尝试在浏览器中访问: ${chatModelConfig.apiUrl.replace('/query/stream', '')}\n• 确保端口9621未被占用`;
                  } else if (error.message.includes('SSL') || error.message.includes('certificate') || error.message.includes('HTTPS')) {
                      errorMessage += `\n\n🔧 HTTPS/SSL问题:\n• 确保您的服务支持HTTPS (SSL/TLS)\n• 如果使用自签名证书，请在浏览器中先访问: ${chatModelConfig.apiUrl.replace('/query/stream', '')}\n• 接受证书警告后再使用语音助手\n• 或在设置中将API地址改为HTTP协议`;
                  } else if (error.message.includes('404')) {
                      errorMessage += `\n\n🔧 API路径错误:\n• 请检查API地址是否正确\n• 当前地址: ${chatModelConfig.apiUrl}\n• 确保服务支持此API路径`;
                  } else if (error.message.includes('500')) {
                      errorMessage += `\n\n🔧 服务器错误:\n• 服务可能存在问题\n• 请检查模型 '${chatModelConfig.model}' 是否已安装\n• 检查服务器日志获取更多信息`;
                  }
                  
                  updateStatus(`发送到聊天模型失败: ${error.message}`, true);
                  addChatMessage(errorMessage, 'error');
              }
            console.error('sendToChatModel error:', error);
            console.error('Current config:', chatModelConfig);
        } finally {
            isProcessing = false;
            currentController = null;
            // 只有在请求完成时才重置请求ID
            if (lastRequestId === requestId) {
                lastRequestId = null;
            }
            if (typeof timeoutId !== 'undefined') {
                clearTimeout(timeoutId);
            }
            if (abortBtn) abortBtn.style.display = 'none';
        }
    }
    

    
    // 添加聊天消息
    function addChatMessage(text, role) {
        // 直接添加消息，不检查重复（即使是重复的问题也显示独立的对话框）
        addMessage(text, role);
    }
    
    // 添加防抖功能，防止短时间内多次调用同一函数
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func.apply(context, args);
            }, wait);
        };
    }
    
    // 录音按钮点击事件
    if (recordBtn) {
        recordBtn.addEventListener('click', () => {
            if (isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        });
    }
    
    // 中断按钮点击事件
    if (abortBtn) {
        abortBtn.addEventListener('click', () => {
            if (currentController) {
                currentController.abort();
                console.log('用户中断了请求');
                updateStatus('请求已中断', true);
                // 隐藏中断按钮
                abortBtn.style.display = 'none';
                // 重置处理中标志
                isProcessing = false;
                currentController = null;
            }
        });
    }
    
    // 创建防抖版本的sendToChatModel函数
    const debouncedSendToChatModel = debounce((text) => {
        sendToChatModel(text);
    }, 300); // 300毫秒内只会执行一次
    
    // 发送到聊天模型按钮点击事件
    if (sendToModelBtn) {
        sendToModelBtn.addEventListener('click', () => {
            if (inputBox && inputBox.textContent.trim() !== '') {
                debouncedSendToChatModel(inputBox.textContent);
            } else {
                console.log('输入框为空，无法发送');
            }
        });
    }
    
    // 输入框按下Enter发送
    if (inputBox) {
        inputBox.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (inputBox.textContent.trim() !== '') {
                    debouncedSendToChatModel(inputBox.textContent);
                } else {
                    console.log('输入框为空，无法发送');
                }
            }
        });
    }
    
    // 检查浏览器支持
    function checkBrowserSupport() {
        // 检查WebRTC支持
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            updateStatus('您的浏览器不支持录音功能', true);
            if (recordBtn) recordBtn.disabled = true;
            return false;
        }
        
        // 检查AudioContext支持
        if (!window.AudioContext && !window.webkitAudioContext) {
            updateStatus('您的浏览器不支持AudioContext', true);
            if (recordBtn) recordBtn.disabled = true;
            return false;
        }
        
        // 检查WebSocket支持
        if (!window.WebSocket) {
            updateStatus('您的浏览器不支持WebSocket', true);
            if (recordBtn) recordBtn.disabled = true;
            return false;
        }
        
        return true;
    }
    
    // 初始化
    function init() {
        if (!checkBrowserSupport()) {
            return;
        }
        
        // 设置默认API地址和WebSocket地址，使用当前页面的主机名
        const defaultApiUrl = `https://${window.location.hostname}:9621/query/stream`;
        const defaultWsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:6016`;
        
        // 先加载已保存的设置
        loadSettings();
        
        // 如果没有保存的设置，使用默认值
        if (!chatModelConfig.apiUrl) {
            chatModelConfig.apiUrl = defaultApiUrl;
            console.log('使用默认API地址:', defaultApiUrl);
        }
        if (!config.serverUrl) {
            config.serverUrl = defaultWsUrl;
            console.log('使用默认WebSocket地址:', defaultWsUrl);
        }
        
        console.log('🚀 初始化完成 - 最终配置:', {
            'API地址': chatModelConfig.apiUrl,
            'WebSocket地址': config.serverUrl,
            '采样率': config.sampleRate,
            '分段长度': config.segDuration,
            '分段重叠': config.segOverlap,
            '系统提示词': chatModelConfig.systemPrompt ? chatModelConfig.systemPrompt.substring(0, 50) + '...' : 'null'
        });
        
        // 添加一个全局函数用于调试
        window.debugVoiceConfig = function() {
            console.log('🔧 当前语音识别配置:', {
                config,
                chatModelConfig,
                wsUrlInput: wsUrlInput ? wsUrlInput.value : 'null',
                audioSampleRateSelect: audioSampleRateSelect ? audioSampleRateSelect.value : 'null',
                queryModeSelect: queryModeSelect ? queryModeSelect.value : 'null',
                isRecording,
                websocketState: websocket ? websocket.readyState : 'null'
            });
            return {
                config,
                chatModelConfig,
                websocketConnected: websocket && websocket.readyState === WebSocket.OPEN
            };
        };
        
        // 添加一个全局函数用于测试查询模式
        window.testQueryMode = function() {
            console.log('🎯 当前查询模式:', chatModelConfig.queryMode);
            console.log('🔧 完整配置:', chatModelConfig);
            return chatModelConfig.queryMode;
        };
        
        // 设置输入框的值
        if (apiUrlInput) {
            apiUrlInput.value = chatModelConfig.apiUrl;
        }
        if (wsUrlInput) {
            wsUrlInput.value = config.serverUrl;
        }
        
        // 尝试连接WebSocket
        connectWebSocket()
            .then(() => {
                updateStatus('准备就绪', false);
                console.log('初始化完成，可以开始语音识别或文字问答');
            })
            .catch(() => {
                updateStatus('无法连接到语音识别服务，请确保服务已启动', true);
                console.log('无法连接到语音识别服务，但文字问答功能仍然可用');
                // 添加一个提示消息
                addMessage('语音识别服务未连接，但您仍然可以通过输入文字进行对话。', 'system');
            });
            
        // 添加页面卸载事件
        window.addEventListener('beforeunload', () => {
            if (isRecording) {
                stopRecording();
            }
            
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                websocket.close();
            }
        });
        
        // 监听设置更新事件
        document.addEventListener('settingsUpdated', function(event) {
            const settings = event.detail;
            console.log('收到设置更新事件:', settings);
            
            let needReconnectWebSocket = false;
            
            // 更新配置
            if (settings.apiUrl) {
                chatModelConfig.apiUrl = settings.apiUrl;
            }
            if (settings.wsUrl && settings.wsUrl !== config.serverUrl) {
                config.serverUrl = settings.wsUrl;
                needReconnectWebSocket = true;
            }
            if (settings.audioSampleRate) {
                config.sampleRate = parseInt(settings.audioSampleRate);
            }
            if (settings.model) {
                chatModelConfig.model = settings.model;
            }
            if (settings.queryMode) {
                chatModelConfig.queryMode = settings.queryMode;
                console.log('查询模式已更新为:', settings.queryMode);
            }
            if (settings.systemPrompt !== undefined) {
                chatModelConfig.systemPrompt = settings.systemPrompt;
            }
            if (settings.temperature) {
                chatModelConfig.temperature = parseFloat(settings.temperature);
            }
            if (settings.maxTokens) {
                chatModelConfig.maxTokens = parseInt(settings.maxTokens);
            }
            // 检索参数已固定在配置中，不再通过设置更新
            if (settings.showDebug !== undefined) {
                chatModelConfig.showDebug = settings.showDebug;
            }
            if (settings.showThinking !== undefined) {
                chatModelConfig.showThinking = settings.showThinking;
                console.log('思考内容显示已更新为:', settings.showThinking);
            }
            
            console.log('配置已更新:', { chatModelConfig, config });
            
            // 如果WebSocket地址发生变化，重新连接
            if (needReconnectWebSocket) {
                console.log('WebSocket地址已更改，正在重新连接:', config.serverUrl);
                connectWebSocket()
                    .then(() => {
                        updateStatus('语音识别服务已重新连接', false);
                        console.log('WebSocket重新连接成功');
                    })
                    .catch(() => {
                        updateStatus('无法连接到新的语音识别服务地址', true);
                        console.log('WebSocket重新连接失败');
                    });
            }
        });
        
        // 聚焦到输入框
        setTimeout(() => {
            if (inputBox) inputBox.focus();
        }, 500);
    }
    
    // 启动初始化
    init();
});