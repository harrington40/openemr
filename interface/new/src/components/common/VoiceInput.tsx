import { useState, useRef, useCallback } from 'react';

interface Props {
  onResult: (text: string) => void;
  placeholder?: string;
  className?: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function VoiceInput({ onResult, placeholder: _placeholder = 'Click mic to dictate...', className = '' }: Props) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Chrome.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let final = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interimText += event.results[i][0].transcript;
        }
      }
      if (final) {
        onResult(final);
        setInterim('');
      } else {
        setInterim(interimText);
      }
    };

    recognition.onerror = () => { setListening(false); };
    recognition.onend = () => { setListening(false); setInterim(''); };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [onResult]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setListening(false);
    setInterim('');
  }, []);

  const isSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  if (!isSupported) {
    return <small className="text-muted">Voice input requires Chrome browser</small>;
  }

  return (
    <div className={`voice-input ${className}`}>
      <div className="d-flex align-items-center gap-2">
        <button
          type="button"
          className={`btn btn-sm ${listening ? 'btn-danger' : 'btn-outline-primary'}`}
          onClick={listening ? stopListening : startListening}
          title={listening ? 'Stop listening' : 'Start voice dictation'}
        >
          <i className={`bi ${listening ? 'bi-mic-fill' : 'bi-mic'}`}></i>
          {listening && <span className="spinner-grow spinner-grow-sm ms-1" style={{ width: '8px', height: '8px' }}></span>}
        </button>
        <span className="small text-muted">
          {listening ? 'Listening... speak now' : 'Click mic to dictate'}
        </span>
      </div>
      {interim && (
        <div className="text-muted small fst-italic mt-1 p-2 bg-light rounded border">
          {interim}
        </div>
      )}
    </div>
  );
}
