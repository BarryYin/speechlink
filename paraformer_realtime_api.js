class ParaformerRealtime {
    constructor(wssUrl) {
        this.wssUrl = wssUrl;
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
    }

    // 连接到 WebSocket 服务并发送 run-task 消息
    connect(callback) {
        return new Promise((resolve, reject) => {
            this.resolveTaskStarted = resolve;
            this.callback = callback; // 存储全局回调函数
            this.socket = new WebSocket(this.wssUrl);

            this.socket.onopen = () => {
                console.log("WebSocket connection established.");
                this.isConnected = true;

                // 生成随机任务 ID
                this.taskId = this.generateUUID();

                // 发送 run-task 消息
                const runTaskMessage = {
                    header: {
                        action: "run-task",
                        task_id: this.taskId,
                        streaming: "duplex"
                    },
                    payload: {
                        task_group: "audio",
                        task: "asr",
                        function: "recognition",
                        model: "paraformer-realtime-v2",
                        parameters: {
                            format: "pcm",
                            sample_rate: 16000,
                            // vocabulary_id: "vocab-xxx-24ee19fa8cfb4d52902170a0xxxxxxxx",
                            disfluency_removal_enabled: false,
                            language_hints: ["zh"]
                        },
                        input: {}
                    }
                };

                this.socket.send(JSON.stringify(runTaskMessage));
                console.log('send message: ', runTaskMessage);
            };

            this.socket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                console.log("Received message:", message);

                // 处理来自服务器的消息
                this.handleServerMessage(message, callback);
            };

            this.socket.onerror = (error) => {
                console.error("WebSocket error:", error);
                this.isConnected = false;
                this.isTaskStarted = false;
                reject(error); // 如果发生错误，reject Promise
            };

            this.socket.onclose = () => {
                console.log("WebSocket connection closed.");
                this.isConnected = false;
                this.isTaskStarted = false;
                if (!this.isTaskStarted) {
                    reject(new Error("WebSocket closed before task started."));
                }
            };
        });
    }

    // 处理来自服务器的消息
    handleServerMessage(message, callback) {
        if (message.header.event === "task-started") {
            // 区分是ASR任务还是翻译任务的启动
            if (message.header.task_id === this.taskId) {
                this.isTaskStarted = true;
                console.log('ASR task started');
                if (this.resolveTaskStarted) {
                    this.resolveTaskStarted();
                }
            } else if (this.translationCallbacks.has(message.header.task_id)) {
                console.log('Translation task started:', message.header.task_id);
            }
        } else if (message.header.event === "task-finished") {
            console.log('recv task-finished', message.header.task_id);
            if (this.resolveTaskFinished && message.header.task_id === this.taskId) {
                this.resolveTaskFinished();
            }
        } else if (message.header.event == 'result-generated') {
            console.log('recv result-generated', message.header.task_id);
            
            // 检查是否是翻译结果
            if (this.translationCallbacks.has(message.header.task_id) && message.payload && message.payload.output) {
                // 处理翻译结果
                const translationCallback = this.translationCallbacks.get(message.header.task_id);
                
                // 从翻译结果中提取翻译文本
                let translatedText = '';
                if (message.payload.output.text) {
                    translatedText = message.payload.output.text;
                } else if (message.payload.output.translation && message.payload.output.translation.text) {
                    translatedText = message.payload.output.translation.text;
                }
                
                if (translatedText && translationCallback) {
                    translationCallback({
                        isTranslation: true,
                        originalText: message.payload.input ? message.payload.input.text || "" : "",
                        translatedText: translatedText,
                        taskId: message.header.task_id
                    });
                    
                    // 翻译结果已经返回，可以从映射表中移除回调
                    this.translationCallbacks.delete(message.header.task_id);
                }
            } 
            // 检查是否是语音识别结果
            else if (message.header.task_id === this.taskId && callback && message.payload.output.sentence.text) {
                // 获取完整的新识别文本
                const fullText = message.payload.output.sentence.text;
                
                // 如果新文本不为空且与上次的不同
                if (fullText && fullText !== this.lastFullText) {
                    // 计算新文本中与上次文本相比新增的部分
                    let newSegment = '';
                    
                    // 从fullText中提取相对于lastFullText的新增部分
                    if (this.lastFullText && fullText.startsWith(this.lastFullText)) {
                        // 如果新文本包含旧文本作为前缀，只取新增部分
                        newSegment = fullText.slice(this.lastFullText.length);
                    } else {
                        // 如果是完全不同的文本（比如修正了之前的识别结果），则完整显示
                        newSegment = fullText;
                    }
                    
                    // 如果提取出了新的文本片段
                    if (newSegment.trim()) {
                        // 清除之前的定时器
                        if (this.textTimer) {
                            clearTimeout(this.textTimer);
                        }

                        // 回调新的文本片段
                        callback({
                            ...message.payload,
                            output: {
                                ...message.payload.output,
                                sentence: {
                                    ...message.payload.output.sentence,
                                    text: newSegment
                                }
                            }
                        });

                        // 更新为完整的新文本和时间戳
                        this.lastFullText = fullText;
                        this.lastUpdateTime = Date.now();
                    }
                }
            }
        }
    }

    // 发送音频数据
    sendAudio(audioData) {
        if (!this.isConnected || !this.isTaskStarted) {
            console.warn("WebSocket is not connected or task has not started, reconnecting...");
            
            // 如果连接已断开，尝试重新连接
            if (!this.isReconnecting) {
                this.isReconnecting = true;
                this.reconnect(this.callback)
                    .then(() => {
                        this.isReconnecting = false;
                        console.log("Reconnection successful");
                        if (audioData instanceof Int16Array) {
                            this.socket.send(audioData);
                        }
                    })
                    .catch(error => {
                        this.isReconnecting = false;
                        console.error("Reconnection failed:", error);
                    });
            }
            return;
        }

        if (!(audioData instanceof Int16Array)) {
            throw new TypeError("Audio data must be an Int16Array.");
        }

        try {
            this.socket.send(audioData);
        } catch (error) {
            console.error("Error sending audio data:", error);
            this.isConnected = false;
            this.isTaskStarted = false;
        }
    }

    // 重新连接WebSocket
    async reconnect(callback) {
        console.log("Attempting to reconnect...");
        if (this.socket) {
            try {
                this.socket.close();
            } catch (e) {
                console.error("Error closing existing socket:", e);
            }
            this.socket = null;
        }
        
        this.isConnected = false;
        this.isTaskStarted = false;
        
        // 重新建立连接
        return this.connect(callback);
    }

    // 使用百炼平台的翻译功能（参考run copy.py中的TranslationRecognizer）
    translate(text, sourceLang, targetLang, callback) {
        if (!this.isConnected) {
            console.error("WebSocket is not connected for translation.");
            return Promise.resolve({
                success: false,
                originalText: text,
                translatedText: text,
                message: "WebSocket is not connected"
            });
        }

        if (!text || text.trim() === '') {
            return Promise.resolve({
                success: false,
                originalText: text,
                translatedText: text,
                message: "Empty text cannot be translated"
            });
        }

        // 生成翻译任务的ID
        const translateTaskId = this.generateUUID();
        
        // 将回调函数存储在映射表中，与任务ID关联
        this.translationCallbacks.set(translateTaskId, callback);
        
        // 构建翻译任务消息，参考run copy.py中的TranslationRecognizer
        const translateTaskMessage = {
            header: {
                action: "run-task",
                task_id: translateTaskId
            },
            payload: {
                task_group: "text",
                task: "translation",
                function: "translate",
                model: "gummy-translation-v1", // 使用与run copy.py相同的模型
                parameters: {
                    source_language: sourceLang,
                    target_language: targetLang
                },
                input: {
                    text: text
                }
            }
        };

        console.log('Sending translation request:', translateTaskMessage);
        
        try {
            this.socket.send(JSON.stringify(translateTaskMessage));
        } catch (error) {
            console.error("Error sending translation request:", error);
            this.translationCallbacks.delete(translateTaskId);
            return Promise.resolve({
                success: false,
                originalText: text,
                translatedText: text,
                message: "Failed to send translation request"
            });
        }
        
        // 返回一个Promise，包含任务ID以便后续跟踪
        return Promise.resolve({
            success: true,
            taskId: translateTaskId,
            originalText: text
        });
    }

    // 停止任务并等待 task-finished 消息
    stop() {
        if (!this.isConnected) {
            console.warn("WebSocket is already disconnected.");
            return Promise.resolve();
        }
        
        if (!this.isTaskStarted) {
            console.warn("Task has not started or already stopped.");
            return Promise.resolve();
        }
        
        const finishTaskMessage = {
            header: {
                action: "finish-task",
                task_id: this.taskId,
                streaming: "duplex"
            },
            payload: {
                input: {}
            }
        };

        try {
            this.socket.send(JSON.stringify(finishTaskMessage));
            console.log('send message: ', finishTaskMessage);
        } catch (error) {
            console.error("Error sending finish-task message:", error);
            return Promise.reject(error);
        }

        return new Promise((resolve) => {
            this.resolveTaskFinished = resolve;
            
            // 设置超时，确保即使没收到task-finished也能正常结束
            setTimeout(() => {
                if (this.isTaskStarted) {
                    console.warn("Task finish timeout, forcing close");
                    this.isTaskStarted = false;
                    if (this.resolveTaskFinished) {
                        this.resolveTaskFinished();
                        this.resolveTaskFinished = null;
                    }
                }
            }, 3000);
        });
    }

    // 关闭 WebSocket 连接
    close() {
        if (this.socket) {
            try {
                this.socket.close();
                this.socket = null;
            } catch (error) {
                console.error("Error closing WebSocket:", error);
            }
        }
        
        this.isConnected = false;
        this.isTaskStarted = false;
        this.translationCallbacks.clear();
    }

    // 生成随机 UUID
    generateUUID() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
}

export default ParaformerRealtime;
