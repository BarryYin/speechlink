import React, { useState, useEffect, useRef } from 'react';
import ParaformerRealtime from './paraformer_realtime_api';
import SpeechDisplayManager from './SpeechDisplayManager';

const SpeechRecognitionDisplay = () => {
  const [transcripts, setTranscripts] = useState([]);
  const displayManagerRef = useRef(new SpeechDisplayManager());
  const paraformerRef = useRef(null);
  
  useEffect(() => {
    // 初始化语音识别API
    const paraformer = new ParaformerRealtime('wss://your-websocket-url');
    paraformerRef.current = paraformer;
    
    // 连接并设置回调处理
    paraformer.connect((result) => {
      // 获取新识别的文本
      const newText = result.output.sentence.text;
      
      // 使用显示管理器处理文本
      const textToDisplay = displayManagerRef.current.processNewText(newText);
      
      // 如果有需要显示的新文本，添加到转录列表
      if (textToDisplay) {
        setTranscripts(prev => [...prev, textToDisplay]);
      }
    });
    
    return () => {
      // 清理连接
      if (paraformerRef.current) {
        paraformerRef.current.close();
      }
    };
  }, []);
  
  // 开始识别按钮处理函数
  const handleStartRecording = () => {
    // 开始录音逻辑
    // ...
  };
  
  // 停止识别按钮处理函数
  const handleStopRecording = () => {
    if (paraformerRef.current) {
      paraformerRef.current.stop();
    }
    // 重置显示管理器
    displayManagerRef.current.reset();
  };
  
  return (
    <div className="speech-recognition-container">
      <div className="transcript-display">
        {transcripts.map((text, index) => (
          <p key={index} className="transcript-segment">{text}</p>
        ))}
      </div>
      
      <div className="control-buttons">
        <button onClick={handleStartRecording}>开始识别</button>
        <button onClick={handleStopRecording}>停止识别</button>
      </div>
    </div>
  );
};

export default SpeechRecognitionDisplay;
