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
    const apiUrlInput = document.getElementById('apiUrl');
    const apiTypeSelect = document.getElementById('apiType');
    const modelSelectInput = document.getElementById('modelSelect');
    const temperatureInput = document.getElementById('temperature');
    const maxTokensInput = document.getElementById('maxTokens');
    const showDebugCheckbox = document.getElementById('showDebug');
    const clearDebugBtn = document.getElementById('clearDebugBtn');
    const wsUrlInput = document.getElementById('wsUrl');
    const audioSampleRateSelect = document.getElementById('audioSampleRate');
    
    // 配置
    const config = {
        serverUrl: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:6016`,  // 语音识别服务的WebSocket地址（默认值，将被设置覆盖）
        sampleRate: 16000,  // 采样率
        segDuration: 15,    // 分段长度
        segOverlap: 2,      // 分段重叠
        reconnectInterval: 1000,  // 重连间隔（毫秒）
        maxReconnectAttempts: 10,  // 最大重连次数
        websocketTimeout: 5000,  // WebSocket连接超时时间（毫秒）
    };
    
    // 聊天模型配置
    const chatModelConfig = {
        apiUrl: `${window.location.protocol}//${window.location.hostname}:11434/api/chat`,
        apiType: 'ollama', // 默认为Ollama格式
        model: 'qwen3-4b-custom',
        temperature: 0.7,
        maxTokens: 100,
        autoSend: true, // 固定为自动发送
        showDebug: false, // 添加调试信息显示设置
        mode: 'cors' // 添加CORS模式
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
    
    // 更新状态显示
    function updateStatus(message, isError = false) {
        statusElement.innerHTML = message;
        statusElement.className = 'status-indicator' + (isError ? ' error' : isRecording ? ' recording' : '');
        console.log(`状态: ${message}`);
    }
    
    // 添加消息到聊天容器
    function addMessage(text, role) {
        // 如果是AI回复，确保清理所有可能的think标签
        if (role === 'ai') {
            text = removeThinkTags(text);
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${role}`;
        
        const metaDiv = document.createElement('div');
        metaDiv.className = 'message-meta';
        
        if (role === 'user') {
            metaDiv.innerHTML = `你`;
        } else if (role === 'ai') {
            metaDiv.innerHTML = `回答`;
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
            
            // 自动发送到聊天模型
            debouncedSendToChatModel(text);
        }
        
        // 滚动到底部
        chatContainer.scrollTop = chatContainer.scrollHeight;
        
        return messageDiv; // 返回创建的消息元素，方便后续操作
    }
    
    // 清空聊天记录
    clearBtn.addEventListener('click', () => {
        chatContainer.innerHTML = '';
        lastRecognizedText = '';
        inputBox.textContent = '';
    });
    
    // 清空输入框
    clearInputBtn.addEventListener('click', () => {
        inputBox.textContent = '';
    });
    
    // 加载设置
    function loadSettings() {
        // 从localStorage加载设置
        const savedSettings = localStorage.getItem('chatModelSettings');
        if (savedSettings) {
            try {
                const settings = JSON.parse(savedSettings);
                chatModelConfig.apiUrl = settings.apiUrl || chatModelConfig.apiUrl;
                chatModelConfig.apiType = settings.apiType || chatModelConfig.apiType;
                chatModelConfig.model = settings.model || chatModelConfig.model;
                chatModelConfig.temperature = settings.temperature || chatModelConfig.temperature;
                chatModelConfig.maxTokens = settings.maxTokens || chatModelConfig.maxTokens;
                chatModelConfig.showDebug = settings.showDebug !== undefined ? settings.showDebug : chatModelConfig.showDebug;
                
                // 加载WebSocket地址设置
                if (settings.wsUrl && wsUrlInput) {
                    config.serverUrl = settings.wsUrl;
                    wsUrlInput.value = settings.wsUrl;
                }
                
                // 加载音频设置
                if (settings.audioSampleRate && audioSampleRateSelect) {
                    chatModelConfig.audioSampleRate = settings.audioSampleRate;
                    audioSampleRateSelect.value = settings.audioSampleRate;
                }
                
                // 更新UI
                apiUrlInput.value = chatModelConfig.apiUrl;
                apiTypeSelect.value = chatModelConfig.apiType;
                modelSelectInput.value = chatModelConfig.model;
                temperatureInput.value = chatModelConfig.temperature;
                document.getElementById('temperatureValue').textContent = chatModelConfig.temperature;
                maxTokensInput.value = chatModelConfig.maxTokens;
                showDebugCheckbox.checked = chatModelConfig.showDebug;
            } catch (error) {
                console.error('加载设置失败:', error);
            }
        } else {
            // 如果没有保存的设置，使用默认值
            if (wsUrlInput) {
                wsUrlInput.value = config.serverUrl;
            }
        }
        
        // 确保自动发送始终为true
        chatModelConfig.autoSend = true;
        
        // 根据设置显示或隐藏调试容器
        toggleDebugContainer();
    }
    
    // 保存设置
    function saveSettings() {
        chatModelConfig.apiUrl = apiUrlInput.value;
        chatModelConfig.apiType = apiTypeSelect.value;
        chatModelConfig.model = modelSelectInput.value;
        chatModelConfig.temperature = parseFloat(temperatureInput.value);
        chatModelConfig.maxTokens = parseInt(maxTokensInput.value);
        chatModelConfig.autoSend = true; // 固定为自动发送
        chatModelConfig.showDebug = showDebugCheckbox.checked;
        
        // 保存WebSocket地址设置
        if (wsUrlInput) {
            chatModelConfig.wsUrl = wsUrlInput.value;
            // 更新配置
            config.serverUrl = wsUrlInput.value;
        }
        
        // 保存音频设置
        if (audioSampleRateSelect) {
            chatModelConfig.audioSampleRate = parseInt(audioSampleRateSelect.value);
            // 更新配置
            config.audioSampleRate = parseInt(audioSampleRateSelect.value);
        }
        
        // 保存到localStorage
        localStorage.setItem('chatModelSettings', JSON.stringify(chatModelConfig));
        
        console.log('设置已保存:', chatModelConfig);
    }
    
    // 切换调试容器显示状态
    function toggleDebugContainer() {
        const debugContainer = document.getElementById('debugContainer');
        if (debugContainer) {
            debugContainer.style.display = chatModelConfig.showDebug ? 'block' : 'none';
        }
    }
    
    // 监听设置变化
    apiUrlInput.addEventListener('change', saveSettings);
    apiTypeSelect.addEventListener('change', saveSettings);
    modelSelectInput.addEventListener('change', saveSettings);
    temperatureInput.addEventListener('change', saveSettings);
    maxTokensInput.addEventListener('change', saveSettings);
    showDebugCheckbox.addEventListener('change', function() {
        saveSettings();
        toggleDebugContainer();
    });
    
    // 监听WebSocket地址变化
    if (wsUrlInput) {
        wsUrlInput.addEventListener('change', function() {
            saveSettings();
            addDebugInfo('INFO', `语音识别服务地址已更改为: ${wsUrlInput.value}`);
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
            addDebugInfo('INFO', `麦克风采样率已更改为: ${audioSampleRateSelect.value} Hz`);
        });
    }
    
    // 清除调试信息按钮事件
    clearDebugBtn.addEventListener('click', function() {
        clearDebugInfo();
    });
    
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
                    addDebugInfo('ERROR', `WebSocket连接超时 (${config.websocketTimeout}ms)`);
                    websocket.close();
                    reject(new Error('WebSocket连接超时'));
                }
            }, config.websocketTimeout);
            
            websocket = new WebSocket(config.serverUrl, ["binary"]);
            addDebugInfo('INFO', `正在连接WebSocket: ${config.serverUrl}`);
            
            websocket.onopen = () => {
                clearTimeout(connectionTimeout);
                updateStatus('已连接到服务器', false);
                addDebugInfo('SUCCESS', 'WebSocket连接成功');
                reconnectAttempts = 0;
                resolve(websocket);
            };
            
            websocket.onerror = (error) => {
                clearTimeout(connectionTimeout);
                updateStatus('连接服务器失败', true);
                console.error('WebSocket错误:', error);
                addDebugInfo('ERROR', `WebSocket连接错误: ${error.message || '未知错误'}`);
                reject(error);
            };
            
            websocket.onclose = (event) => {
                updateStatus('与服务器的连接已关闭', false);
                console.log('WebSocket关闭:', event.code, event.reason);
                addDebugInfo('WARNING', `WebSocket关闭: 代码=${event.code}, 原因=${event.reason || '未知'}`);
                
                // 如果正在录音，尝试重连
                if (isRecording && reconnectAttempts < config.maxReconnectAttempts) {
                    reconnectAttempts++;
                    updateStatus(`正在尝试重新连接 (${reconnectAttempts}/${config.maxReconnectAttempts})...`, false);
                    addDebugInfo('INFO', `尝试重连 #${reconnectAttempts}`);
                    
                    setTimeout(() => {
                        connectWebSocket()
                            .then(() => {
                                updateStatus('重新连接成功，继续录音', false);
                                addDebugInfo('SUCCESS', '重新连接成功');
                            })
                            .catch((error) => {
                                addDebugInfo('ERROR', `重连失败: ${error.message || '未知错误'}`);
                                if (reconnectAttempts >= config.maxReconnectAttempts) {
                                    updateStatus('重连失败，已停止录音', true);
                                    addDebugInfo('ERROR', '达到最大重连次数，停止录音');
                                    stopRecording();
                                }
                            });
                    }, config.reconnectInterval);
                } else if (!isRecording) {
                    addDebugInfo('INFO', 'WebSocket关闭，但未在录音，不尝试重连');
                } else {
                    addDebugInfo('ERROR', '达到最大重连次数，停止录音');
                    stopRecording();
                }
            };
            
            websocket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.text) {
                        if (message.is_final) {
                            const recognizedText = message.text;
                            addMessage(recognizedText, 'user');
                            updateStatus(`识别完成，用时：${(message.time_complete - message.time_submit).toFixed(2)}秒`, false);
                        } else {
                            // 可以添加实时显示中间结果的逻辑
                            updateStatus('正在识别...', false);
                        }
                    }
                } catch (error) {
                    console.error('解析消息失败:', error);
                }
            };
        });
    }
    
    // 开始录音
    async function startRecording() {
        try {
            // 禁用按钮，防止重复点击
            recordBtn.disabled = true;
            
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
            
            // 获取用户选择的采样率或使用默认值
            const selectedSampleRate = audioSampleRateSelect ? parseInt(audioSampleRateSelect.value) : 44100;
            
            // 创建音频上下文
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: selectedSampleRate  // 使用用户选择的采样率
            });
            
            // 记录实际采样率（可能与请求的不同）
            addDebugInfo('INFO', `音频上下文创建成功，采样率: ${audioContext.sampleRate} Hz`);
            
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
                    
                    // 重采样到16kHz
                    const resampledData = resampleAudio(combinedData, audioContext.sampleRate, config.sampleRate);
                    
                    // 发送音频数据
                    sendAudioData(resampledData);
                }
            };
            
            // 连接节点
            sourceNode.connect(processorNode);
            processorNode.connect(audioContext.destination);
            
            // 更新UI
            recordBtn.innerHTML = '停止';
            recordBtn.classList.add('recording');
            isRecording = true;
            updateStatus('正在录音...', false);
            
            // 添加调试信息
            addDebugInfo('INFO', '开始录音，WebSocket已连接');
            
            // 启用按钮
            recordBtn.disabled = false;
            
        } catch (error) {
            console.error('开始录音失败:', error);
            updateStatus('开始录音失败: ' + error.message, true);
            recordBtn.disabled = false;
        }
    }
    
    // 停止录音
    function stopRecording() {
        if (!isRecording) return;
        
        // 禁用按钮，防止重复点击
        recordBtn.disabled = true;
        
        // 更新UI
        recordBtn.innerHTML = '录音';
        recordBtn.classList.remove('recording');
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
        recordBtn.disabled = false;
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
            addDebugInfo('WARNING', 'WebSocket未连接，无法发送音频数据');
            
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
            websocket.send(JSON.stringify(message));
        } catch (error) {
            console.error('发送音频数据失败:', error);
            addDebugInfo('ERROR', `发送音频数据失败: ${error.message}`);
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
            addDebugInfo('WARNING', 'WebSocket未连接，无法发送结束信号');
            
            // 尝试重新连接一次，专门用于发送结束信号
            try {
                // 创建一个新的WebSocket连接，确保使用正确的协议
                const secureUrl = window.location.protocol === 'https:' ? 
                    config.serverUrl.replace('ws:', 'wss:') : config.serverUrl;
                const tempSocket = new WebSocket(secureUrl);
                
                tempSocket.onopen = () => {
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
                    
                    // 发送消息
                    tempSocket.send(JSON.stringify(message));
                    
                    // 短暂延迟后关闭连接
                    setTimeout(() => {
                        tempSocket.close();
                    }, 1000);
                    
                    addDebugInfo('INFO', '通过临时连接发送了结束信号');
                };
                
                tempSocket.onerror = () => {
                    addDebugInfo('ERROR', '临时WebSocket连接失败，无法发送结束信号');
                };
            } catch (e) {
                addDebugInfo('ERROR', `创建临时WebSocket失败: ${e.message}`);
            }
            
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
            
            addDebugInfo('INFO', '发送结束信号');
            
            // 发送消息
            websocket.send(JSON.stringify(message));
        } catch (error) {
            console.error('发送结束信号失败:', error);
            addDebugInfo('ERROR', `发送结束信号失败: ${error.message}`);
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
    
    // 发送到聊天模型
    async function sendToChatModel(text) {
        // 防止重复发送
        if (isProcessing) {
            addDebugInfo('WARNING', '正在处理上一条消息，忽略重复请求');
            return;
        }
        
        if (!text || text.trim() === '') {
            if (inputBox.textContent.trim() !== '') {
                text = inputBox.textContent.trim();
            } else {
                updateStatus('没有可发送的文本', true);
                return;
            }
        }
        
        // 防止重复添加相同的消息
        const messages = chatContainer.querySelectorAll('.message-user');
        const lastUserMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        const isDuplicate = lastUserMessage && 
                           lastUserMessage.querySelector('.message-content').textContent === text;
        
        // The existing logic for adding user message to chat container
        if (!isDuplicate) {
            if (text === inputBox.textContent.trim()) {
                addChatMessage(text, 'user');
                inputBox.textContent = '';
                inputBox.focus();
            } else if (!lastRecognizedText || text !== lastRecognizedText) {
                addChatMessage(text, 'user');
            }
        } else {
            if (text === inputBox.textContent.trim()) {
                inputBox.textContent = '';
                inputBox.focus();
            }
        }

        isProcessing = true;
        updateStatus('正在等待模型响应...', false);
        addDebugInfo('INFO', `Sending text to chat model: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

        try {
            let requestData;
            // Set stream to true for streaming response
            if (chatModelConfig.apiUrl.includes('api/chat') || chatModelConfig.apiUrl.includes('v1/chat')) {
                requestData = {
                    model: chatModelConfig.model,
                    messages: [{ role: "user", content: text }],
                    stream: true, // Enable streaming
                    temperature: chatModelConfig.temperature,
                    max_tokens: chatModelConfig.maxTokens
                };
            } else {
                requestData = {
                    model: chatModelConfig.model,
                    prompt: text,
                    stream: true, // Enable streaming
                    temperature: chatModelConfig.temperature,
                    num_predict: chatModelConfig.maxTokens
                };
            }

            addDebugInfo('REQUEST', `URL: ${chatModelConfig.apiUrl}\nData: ${JSON.stringify(requestData, null, 2)}`);
            
            currentController = new AbortController();
            const timeoutId = setTimeout(() => currentController.abort(), 60000);
            abortBtn.style.display = 'block';

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

            // Create a new message container for the AI response
            const aiMessageDiv = addMessage('', 'ai');
            const aiContentDiv = aiMessageDiv.querySelector('.message-content');
            aiContentDiv.innerHTML = ''; // Clear initial content

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let partialResponse = '';
            
            updateStatus('模型正在回复...', false);

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
                        if (parsed.response) { // Ollama generate API
                            chunk = parsed.response;
                        } else if (parsed.choices && parsed.choices[0].delta && parsed.choices[0].delta.content) { // OpenAI-compatible chat API
                            chunk = parsed.choices[0].delta.content;
                        } else if (parsed.message && parsed.message.content) { // Ollama chat API
                             chunk = parsed.message.content;
                             if(parsed.done) { // ollama chat api done is not in chunk
                                // already handled by reader done
                             }
                        }
                        
                        if (chunk) {
                            // Append chunk to the message content
                            aiContentDiv.innerHTML += removeThinkTags(chunk).replace(/\n/g, '<br>');
                            chatContainer.scrollTop = chatContainer.scrollHeight;
                        }
                    } catch (e) {
                        console.error('Error parsing streaming JSON:', e, 'line:', line);
                        addDebugInfo('ERROR', `JSON parse error in stream: ${e.message}`);
                    }
                }
            }

            updateStatus('聊天模型响应完成', false);

        } catch (error) {
            if (error.name === 'AbortError') {
                updateStatus('请求已中断', true);
                addChatMessage('请求已被用户中断', 'system');
            } else {
                updateStatus(`发送到聊天模型失败: ${error.message}`, true);
                addChatMessage(`请求失败: ${error.message}`, 'error');
            }
            console.error('sendToChatModel error:', error);
        } finally {
            isProcessing = false;
            currentController = null;
            abortBtn.style.display = 'none';
        }
    }
    
    // 去除模型内部思考标签及其内容
    function removeThinkTags(text) {
        if (!text) return text;
        
        // 使用正则表达式去除各种内部思考标签及其内容
        const tagsToRemove = [
            // 标准XML/HTML风格标签
            /<think>[\s\S]*?<\/think>/g,           // <think>标签
            /<reasoning>[\s\S]*?<\/reasoning>/g,   // <reasoning>标签
            /<thought>[\s\S]*?<\/thought>/g,       // <thought>标签
            /<reflection>[\s\S]*?<\/reflection>/g, // <reflection>标签
            /<internal>[\s\S]*?<\/internal>/g,     // <internal>标签
            /<planning>[\s\S]*?<\/planning>/g,     // <planning>标签
            
            // Markdown风格标签
            /\[\[think\]\][\s\S]*?\[\[\/think\]\]/g,       // [[think]]标签
            /\[\[reasoning\]\][\s\S]*?\[\[\/reasoning\]\]/g, // [[reasoning]]标签
            /\[\[thought\]\][\s\S]*?\[\[\/thought\]\]/g,   // [[thought]]标签
            
            // 其他常见格式
            /\{\{think:[\s\S]*?\}\}/g,             // {{think:...}}格式
            /\{\{thinking:[\s\S]*?\}\}/g,          // {{thinking:...}}格式
            /\(thinking:[\s\S]*?\)/g,              // (thinking:...)格式
            /\(think:[\s\S]*?\)/g,                 // (think:...)格式
            
            // 特殊格式
            /<thinking>[\s\S]*?<\/antml:thinking>/g, // <thinking>格式
            /<assistant:thinking>[\s\S]*?<\/assistant:thinking>/g, // <assistant:thinking>格式
            
            // 单行think前缀
            /^think:.*$/gm,                        // 以think:开头的行
            /^thinking:.*$/gm,                     // 以thinking:开头的行
            
            // 处理可能的大写变体
            /<THINK>[\s\S]*?<\/THINK>/g,
            /<REASONING>[\s\S]*?<\/REASONING>/g,
            /<THOUGHT>[\s\S]*?<\/THOUGHT>/g,
            
            // 处理未配对的结束标签
            /<\/think>\s*/g,                       // 未配对的</think>标签
            /<\/reasoning>\s*/g,                   // 未配对的</reasoning>标签
            /<\/thought>\s*/g,                     // 未配对的</thought>标签
            /<\/reflection>\s*/g,                  // 未配对的</reflection>标签
            /<\/internal>\s*/g,                    // 未配对的</internal>标签
            /<\/planning>\s*/g,                    // 未配对的</planning>标签
            /<\/THINK>\s*/g,                       // 未配对的</THINK>标签
            /<\/REASONING>\s*/g,                   // 未配对的</REASONING>标签
            /<\/THOUGHT>\s*/g,                     // 未配对的</THOUGHT>标签
            /\[\[\/think\]\]\s*/g,                 // 未配对的[[/think]]标签
            /\[\[\/reasoning\]\]\s*/g,             // 未配对的[[/reasoning]]标签
            /\[\[\/thought\]\]\s*/g                // 未配对的[[/thought]]标签
        ];
        
        let cleanedText = text;
        let previousLength;
        
        // 多次应用正则表达式，处理嵌套标签
        do {
            previousLength = cleanedText.length;
            
            // 依次应用每个正则表达式
            for (const regex of tagsToRemove) {
                cleanedText = cleanedText.replace(regex, '');
            }
            
            // 如果有内容被移除，记录日志
            if (cleanedText.length !== previousLength) {
                console.log(`已移除内部思考标签内容`);
            }
            
            // 继续循环直到没有更多内容被移除
        } while (cleanedText.length !== previousLength);
        
        // 清理可能产生的多余空行和空白
        cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n');
        cleanedText = cleanedText.replace(/^\s+|\s+$/g, ''); // 移除开头和结尾的空白
        
        // 处理多个连续空行的情况
        cleanedText = cleanedText.replace(/\n\s*\n\s*\n/g, '\n\n');
        
        return cleanedText;
    }
    
    // 添加调试信息到页面
    function addDebugInfo(type, message) {
        // 如果调试模式关闭，只记录到控制台
        if (!chatModelConfig.showDebug) {
            console.log(`[${type}]`, message);
            return;
        }
        
        // 检查是否已存在调试容器
        let debugContainer = document.getElementById('debugContainer');
        
        // 如果不存在，创建一个
        if (!debugContainer) {
            debugContainer = document.createElement('div');
            debugContainer.id = 'debugContainer';
            debugContainer.style.position = 'fixed';
            debugContainer.style.bottom = '10px';
            debugContainer.style.right = '10px';
            debugContainer.style.width = '300px';
            debugContainer.style.maxHeight = '200px';
            debugContainer.style.overflowY = 'auto';
            debugContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            debugContainer.style.color = 'white';
            debugContainer.style.padding = '10px';
            debugContainer.style.borderRadius = '5px';
            debugContainer.style.fontSize = '12px';
            debugContainer.style.zIndex = '9999';
            debugContainer.style.display = chatModelConfig.showDebug ? 'block' : 'none';
            
            // 添加标题和清除按钮
            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.marginBottom = '5px';
            
            const title = document.createElement('span');
            title.textContent = '调试信息';
            title.style.fontWeight = 'bold';
            
            const clearBtn = document.createElement('button');
            clearBtn.textContent = '清除';
            clearBtn.style.backgroundColor = '#555';
            clearBtn.style.color = 'white';
            clearBtn.style.border = 'none';
            clearBtn.style.padding = '2px 5px';
            clearBtn.style.borderRadius = '3px';
            clearBtn.style.cursor = 'pointer';
            clearBtn.onclick = () => {
                const content = document.getElementById('debugContent');
                if (content) content.innerHTML = '';
            };
            
            header.appendChild(title);
            header.appendChild(clearBtn);
            debugContainer.appendChild(header);
            
            // 添加内容容器
            const content = document.createElement('div');
            content.id = 'debugContent';
            debugContainer.appendChild(content);
            
            document.body.appendChild(debugContainer);
        }
        
        // 添加新的调试信息
        const content = document.getElementById('debugContent');
        const entry = document.createElement('div');
        entry.style.borderBottom = '1px solid #555';
        entry.style.paddingBottom = '5px';
        entry.style.marginBottom = '5px';
        
        const timestamp = document.createElement('div');
        timestamp.textContent = new Date().toLocaleTimeString();
        timestamp.style.color = '#aaa';
        timestamp.style.fontSize = '10px';
        
        const typeSpan = document.createElement('span');
        typeSpan.textContent = type;
        typeSpan.style.fontWeight = 'bold';
        typeSpan.style.color = type === 'ERROR' ? '#ff6b6b' : '#4ecdc4';
        
        const messageContent = document.createElement('div');
        messageContent.style.wordBreak = 'break-word';
        messageContent.style.whiteSpace = 'pre-wrap';
        
        if (typeof message === 'object') {
            try {
                messageContent.textContent = JSON.stringify(message, null, 2);
            } catch (e) {
                messageContent.textContent = '无法序列化对象: ' + e.message;
            }
        } else {
            messageContent.textContent = message;
        }
        
        entry.appendChild(timestamp);
        entry.appendChild(typeSpan);
        entry.appendChild(document.createTextNode(': '));
        entry.appendChild(messageContent);
        
        content.appendChild(entry);
        content.scrollTop = content.scrollHeight;
    }
    
    // 添加聊天消息
    function addChatMessage(text, role) {
        // 检查是否已经有相同的消息
        const messages = chatContainer.querySelectorAll(`.message-${role}`);
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        
        // 如果最后一条消息与当前消息相同，则不添加
        if (lastMessage && lastMessage.querySelector('.message-content').textContent === text) {
            addDebugInfo('INFO', `跳过重复消息: ${role}`);
            return;
        }
        
        // 使用新的addMessage函数添加消息
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
    recordBtn.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });
    
    // 中断按钮点击事件
    abortBtn.addEventListener('click', () => {
        if (currentController) {
            currentController.abort();
            addDebugInfo('INFO', '用户中断了请求');
            updateStatus('请求已中断', true);
            // 隐藏中断按钮
            abortBtn.style.display = 'none';
            // 重置处理中标志
            isProcessing = false;
            currentController = null;
        }
    });
    
    // 创建防抖版本的sendToChatModel函数
    const debouncedSendToChatModel = debounce((text) => {
        sendToChatModel(text);
    }, 300); // 300毫秒内只会执行一次
    
    // 发送到聊天模型按钮点击事件
    sendToModelBtn.addEventListener('click', () => {
        if (inputBox.textContent.trim() !== '') {
            debouncedSendToChatModel(inputBox.textContent);
        } else {
            addDebugInfo('INFO', '输入框为空，无法发送');
        }
    });
    
    // 输入框按下Enter发送
    inputBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (inputBox.textContent.trim() !== '') {
                debouncedSendToChatModel(inputBox.textContent);
            } else {
                addDebugInfo('INFO', '输入框为空，无法发送');
            }
        }
    });
    
    // 检查浏览器支持
    function checkBrowserSupport() {
        // 检查WebRTC支持
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            updateStatus('您的浏览器不支持录音功能', true);
            recordBtn.disabled = true;
            return false;
        }
        
        // 检查AudioContext支持
        if (!window.AudioContext && !window.webkitAudioContext) {
            updateStatus('您的浏览器不支持AudioContext', true);
            recordBtn.disabled = true;
            return false;
        }
        
        // 检查WebSocket支持
        if (!window.WebSocket) {
            updateStatus('您的浏览器不支持WebSocket', true);
            recordBtn.disabled = true;
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
        const defaultApiUrl = `${window.location.protocol}//${window.location.hostname}:11434/api/chat`;
        const defaultWsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:6016`;
        
        // 设置默认值到输入框
        apiUrlInput.value = apiUrlInput.value || defaultApiUrl;
        wsUrlInput.value = wsUrlInput.value || defaultWsUrl;
        
        // 更新配置
        chatModelConfig.apiUrl = apiUrlInput.value;
        config.serverUrl = wsUrlInput.value;
        
        // 加载设置
        loadSettings();
        
        // 确保WebSocket地址显示正确
        if (wsUrlInput && !wsUrlInput.value) {
            wsUrlInput.value = config.serverUrl;
        }
        
        // 确保API地址显示正确
        if (apiUrlInput && !apiUrlInput.value) {
            apiUrlInput.value = chatModelConfig.apiUrl;
        }
        
        // 初始化调试容器的显示状态
        toggleDebugContainer();
        
        // 尝试连接WebSocket
        connectWebSocket()
            .then(() => {
                updateStatus('准备就绪', false);
                addDebugInfo('INFO', '初始化完成，可以开始语音识别或文字问答');
            })
            .catch(() => {
                updateStatus('无法连接到语音识别服务，请确保服务已启动', true);
                addDebugInfo('WARNING', '无法连接到语音识别服务，但文字问答功能仍然可用');
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
        
        // 聚焦到输入框
        setTimeout(() => {
            inputBox.focus();
        }, 500);
    }
    
    // 启动初始化
    init();
    
    // 清除调试信息
    function clearDebugInfo() {
        const debugContent = document.getElementById('debugContent');
        if (debugContent) {
            debugContent.innerHTML = '';
            addDebugInfo('INFO', '调试信息已清除');
        }
    }
});