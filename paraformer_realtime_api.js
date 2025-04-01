class ParaformerRealtime {
    constructor(apiKey, options = {}) {
        this.baseWssUrl = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/";
        this.apiKey = apiKey;
        this.socket = null;
        this.taskId = null;
        this.isConnected = false;
        this.isTaskStarted = false;
        this.messageQueue = [];
        this.resolveTaskStarted = null;
        this.resolveTaskFinished = null;
        this.lastFullText = ''; // 存储上一次完整的识别结果文本
        this.lastUpdateTime = Date.now();
        this.textTimer = null;
        this.translationCallbacks = new Map(); // 存储翻译回调函数的映射表
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 3;
        this.isReconnecting = false;
        this.connectTimeoutId = null;
        this.errorHandler = null; // 添加错误处理器
        this.options = options;
    }
    
    // 设置自定义错误处理器
    setErrorHandler(handler) {
        this.errorHandler = handler;
    }
    
    // 处理API错误
    handleApiError(error) {
        console.error("API错误:", error);
        
        // 特别处理403权限错误
        if (error.code === 403 || (error.message && error.message.includes("permission"))) {
            console.error("检测到API权限错误 (403):", error);
            const permissionError = {
                code: 403,
                message: "API权限错误：您的API密钥无效或已过期，请检查DashScope API密钥是否正确",
                handled: false, // 标记为需要UI处理
                httpError: false,
                httpStatus: 200,
                httpStatusText: "",
                name: "API权限错误",
                originalError: error
            };
            
            // 如果设置了错误处理器，则调用它
            if (this.errorHandler && typeof this.errorHandler === 'function') {
                this.errorHandler(permissionError);
            }
            
            return permissionError;
        }
        
        // 处理其他错误类型
        const genericError = {
            code: error.code || 500,
            message: error.message || "未知API错误",
            handled: false,
            httpError: false,
            httpStatus: 200, 
            httpStatusText: "",
            name: "API错误",
            originalError: error
        };
        
        // 如果设置了错误处理器，则调用它
        if (this.errorHandler && typeof this.errorHandler === 'function') {
            this.errorHandler(genericError);
        }
        
        return genericError;
    }
    
    // 获取完整的WebSocket URL，包含API密钥
    getWebSocketUrl() {
        // 确保URL包含API密钥
        const urlWithAuth = new URL(this.baseWssUrl);
        urlWithAuth.searchParams.append('api_key', this.apiKey);
        return urlWithAuth.toString();
    }
    
    // 连接到 WebSocket 服务并发送 run-task 消息
    connect(callback) {
        const wssUrl = this.getWebSocketUrl();
        console.log("尝试连接到 WebSocket 服务");
        
        // 清除之前的超时计时器
        if (this.connectTimeoutId) {
            clearTimeout(this.connectTimeoutId);
        }
        
        return new Promise((resolve, reject) => {
            this.resolveTaskStarted = resolve;
            this.callback = callback; // 存储全局回调函数
            
            // 检查API密钥是否存在
            if (!this.apiKey) {
                const error = {
                    code: 403,
                    message: "API密钥缺失：请提供有效的DashScope API密钥",
                    handled: false
                };
                
                console.error("API密钥缺失");
                this.handleApiError(error);
                reject(error);
                return;
            }
            
            try {
                // 创建WebSocket连接
                this.socket = new WebSocket(wssUrl);
                
                // 设置连接超时
                this.connectTimeoutId = setTimeout(() => {
                    if (this.socket && this.socket.readyState !== WebSocket.OPEN) {
                        console.error("WebSocket连接超时");
                        const error = {
                            code: 408,
                            message: "连接超时：无法连接到DashScope服务",
                            handled: false
                        };
                        this.handleApiError(error);
                        this.socket.close();
                        reject(error);
                    }
                }, 10000); // 10秒超时
                
                // 连接成功
                this.socket.onopen = () => {
                    console.log("WebSocket连接已建立");
                    clearTimeout(this.connectTimeoutId);
                    
                    this.isConnected = true;
                    this.connectionAttempts = 0;
                    
                    // 生成任务ID
                    this.taskId = this.generateUUID();
                    
                    // 发送任务开始信息
                    const startMessage = {
                        task_id: this.taskId,
                        action: "start",
                        namespace: "speech_recognition",
                        model: "paraformer-realtime-v1",
                        payload: {
                            format: "pcm",
                            sample_rate: 16000
                        }
                    };
                    
                    this.socket.send(JSON.stringify(startMessage));
                    console.log("已发送任务开始消息");
                    
                    // 模拟成功连接的回调
                    if (typeof callback === 'function') {
                        callback({
                            type: 'status',
                            status: 'connected',
                            message: '已成功连接到服务'
                        });
                    }
                    
                    resolve({
                        status: 'success',
                        message: '连接成功'
                    });
                };
                
                // 连接错误
                this.socket.onerror = (event) => {
                    console.error("WebSocket连接错误:", event);
                    clearTimeout(this.connectTimeoutId);
                    
                    const error = {
                        code: 500,
                        message: "WebSocket连接错误",
                        handled: false,
                        originalError: event
                    };
                    
                    this.handleApiError(error);
                    reject(error);
                };
                
                // 连接关闭
                this.socket.onclose = (event) => {
                    console.log("WebSocket连接已关闭:", event.code, event.reason);
                    clearTimeout(this.connectTimeoutId);
                    
                    this.isConnected = false;
                    
                    // 如果是认证错误导致的关闭
                    if (event.code === 1008 || event.code === 3000) {
                        const authError = {
                            code: 403,
                            message: "API认证失败：请检查您的DashScope API密钥是否有效",
                            handled: false,
                            originalError: event
                        };
                        this.handleApiError(authError);
                    }
                    
                    // 通知UI连接已关闭
                    if (typeof callback === 'function') {
                        callback({
                            type: 'status',
                            status: 'disconnected',
                            message: '与服务器的连接已断开'
                        });
                    }
                };
                
                // 接收消息
                this.socket.onmessage = (event) => {
                    try {
                        const response = JSON.parse(event.data);
                        console.log("收到WebSocket消息类型:", response.action || response.status);
                        
                        // 处理错误响应
                        if (response.status === 'failed' || (response.code && response.code >= 400)) {
                            const apiError = {
                                code: response.code || 500,
                                message: response.message || "API调用失败",
                                handled: false,
                                originalError: response
                            };
                            this.handleApiError(apiError);
                            return;
                        }
                        
                        // 处理识别结果
                        if (response.payload && response.payload.text !== undefined) {
                            const result = {
                                type: 'result',
                                text: response.payload.text,
                                isFinal: response.payload.is_final || false
                            };
                            
                            if (typeof callback === 'function') {
                                callback(result);
                            }
                        }
                    } catch (error) {
                        console.error("处理WebSocket消息时出错:", error);
                    }
                };
                
            } catch (error) {
                clearTimeout(this.connectTimeoutId);
                console.error("创建 WebSocket 连接时出错:", error);
                
                // 回退到测试模式或显示错误
                if (this.options.fallbackToTestMode) {
                    console.log("回退到测试模式...");
                    this.isConnected = true;
                    this.connectionAttempts = 0;
                    this.taskId = this.generateUUID();
                    
                    if (typeof callback === 'function') {
                        callback({
                            type: 'status',
                            status: 'connected',
                            message: '已成功连接到服务（测试模式）'
                        });
                    }
                    
                    resolve({
                        status: 'success',
                        message: '连接成功（测试模式）'
                    });
                } else {
                    this.handleApiError(error);
                    reject(error);
                }
            }
        });
    }
    
    // 生成UUID
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    // 发送音频数据
    sendAudioData(audioData) {
        if (!this.isConnected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket未连接，无法发送音频数据');
            return false;
        }
        
        try {
            // 构建音频数据消息
            const audioMessage = {
                task_id: this.taskId,
                action: "predict",
                namespace: "speech_recognition",
                payload: {
                    audio_data: this.arrayBufferToBase64(audioData.buffer)
                }
            };
            
            // 发送音频数据
            this.socket.send(JSON.stringify(audioMessage));
            return true;
        } catch (error) {
            console.error('发送音频数据时出错:', error);
            this.handleApiError(error);
            return false;
        }
    }
    
    // 将ArrayBuffer转换为Base64字符串
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
    
    // 添加 sendAudio 方法作为 sendAudioData 的别名，修复 TypeError
    sendAudio(audioData) {
        return this.sendAudioData(audioData);
    }
    
    // 停止任务
    stopTask() {
        if (!this.isConnected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.log('WebSocket未连接，无需停止任务');
            this.isTaskStarted = false;
            return true;
        }
        
        try {
            // 发送停止任务的消息
            const stopMessage = {
                task_id: this.taskId,
                action: "stop",
                namespace: "speech_recognition"
            };
            
            this.socket.send(JSON.stringify(stopMessage));
            console.log('已发送停止任务消息');
            
            this.isTaskStarted = false;
            
            // 如果有回调函数，则调用它通知任务已停止
            if (typeof this.callback === 'function') {
                this.callback({
                    type: 'status',
                    status: 'stopped',
                    message: '识别已停止'
                });
            }
            
            return true;
        } catch (error) {
            console.error('停止任务时出错:', error);
            this.handleApiError(error);
            return false;
        }
    }
    
    // 关闭连接
    disconnect() {
        if (!this.socket) {
            console.log('无WebSocket连接，无需断开');
            this.isConnected = false;
            this.isTaskStarted = false;
            return true;
        }
        
        try {
            // 先停止任务
            if (this.isTaskStarted) {
                this.stopTask();
            }
            
            // 关闭WebSocket连接
            if (this.socket.readyState === WebSocket.OPEN || 
                this.socket.readyState === WebSocket.CONNECTING) {
                this.socket.close();
                console.log('WebSocket连接已关闭');
            }
            
            this.socket = null;
            this.isConnected = false;
            this.isTaskStarted = false;
            
            return true;
        } catch (error) {
            console.error('断开连接时出错:', error);
            this.socket = null;
            this.isConnected = false;
            this.isTaskStarted = false;
            return false;
        }
    }
    
    // 启动任务
    startTask() {
        if (!this.isConnected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket未连接，无法启动任务');
            return false;
        }
        
        try {
            // 发送启动任务的消息
            const startMessage = {
                task_id: this.taskId,
                action: "start",
                namespace: "speech_recognition",
                model: "paraformer-realtime-v1",
                payload: {
                    format: "pcm",
                    sample_rate: 16000
                }
            };
            
            this.socket.send(JSON.stringify(startMessage));
            console.log('已发送启动任务消息');
            
            this.isTaskStarted = true;
            return true;
        } catch (error) {
            console.error('启动任务时出错:', error);
            this.handleApiError(error);
            return false;
        }
    }
    
    // 停止方法，用于外部调用
    stop() {
        return new Promise((resolve, reject) => {
            try {
                const result = this.stopTask();
                resolve(result);
            } catch (error) {
                console.error('停止操作时出错:', error);
                this.handleApiError(error);
                reject(error);
            }
        });
    }
}
export default ParaformerRealtime;