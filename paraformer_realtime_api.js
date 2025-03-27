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
    }

    // 连接到 WebSocket 服务并发送 run-task 消息
    connect(callback) {
        return new Promise((resolve, reject) => {
            this.resolveTaskStarted = resolve;
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
                console.log('send message: ', runTaskMessage)
            };

            this.socket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                console.log("Received message:", message);

                if (message.header.event === "task-started") {
                    this.isTaskStarted = true;
                    console.log('recv started');
                    if (this.resolveTaskStarted) {
                        this.resolveTaskStarted();
                    }
                    resolve(); // 在接收到 task-started 后 resolve Promise
                } else if (message.header.event === "task-finished") {
                    console.log('recv task-finished');
                    if (this.resolveTaskFinished) {
                        this.resolveTaskFinished();
                    }
                } else if (message.header.event == 'result-generated') {
                    console.log('recv result-generated');
                    if (callback && message.payload.output.sentence.text) {
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
            };

            this.socket.onerror = (error) => {
                console.error("WebSocket error:", error);
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

    // 发送音频数据
    sendAudio(audioData) {
        if (!this.isConnected || !this.isTaskStarted) {
            throw new Error("WebSocket is not connected or task has not started.");
        }

        if (!(audioData instanceof Int16Array)) {
            throw new TypeError("Audio data must be an Int16Array.");
        }

        this.socket.send(audioData);
    }

    // 停止任务并等待 task-finished 消息
    stop() {
        if (!this.isConnected || !this.isTaskStarted) {
            throw new Error("WebSocket is not connected or task has not started.");
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

        this.socket.send(JSON.stringify(finishTaskMessage));
        console.log('send message: ', finishTaskMessage)

        return new Promise((resolve, reject) => {
            this.resolveTaskFinished = resolve;
        });
    }

    // 关闭 WebSocket 连接
    close() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
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
