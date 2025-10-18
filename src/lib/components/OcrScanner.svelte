<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Tesseract from 'tesseract.js';
  import type { OcrState, StatusType } from '$lib/types';

  let video: HTMLVideoElement;
  let canvas: HTMLCanvasElement;
  let preview: HTMLImageElement;

  let state: OcrState = {
    stream: null,
    capturedImage: null,
    extractedText: '',
    statusMessage: 'Prêt à scanner un document',
    statusType: 'info',
    showVideo: false,
    showPreview: false,
    showCaptureBtn: false,
    showProcessBtn: false,
    showSpeakBtn: false,
    showLoader: false,
    showResult: false,
    processBtnDisabled: false
  };

  function updateStatus(message: string, type: StatusType = 'info'): void {
    state.statusMessage = message;
    state.statusType = type;
  }

  async function startCamera(): Promise<void> {
    try {
      updateStatus('Démarrage de la caméra...', 'info');
      
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      state.stream = mediaStream;
      video.srcObject = mediaStream;
      state.showVideo = true;
      state.showPreview = false;
      state.showCaptureBtn = true;
      
      updateStatus('Caméra active - Positionnez le document', 'success');
    } catch (err) {
      const error = err as Error;
      updateStatus('Erreur d\'accès à la caméra: ' + error.message, 'error');
    }
  }

  function captureImage(): void {
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    state.capturedImage = canvas.toDataURL('image/jpeg', 0.95);
    
    preview.src = state.capturedImage;
    state.showPreview = true;
    state.showVideo = false;
    
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
    }
    
    state.showCaptureBtn = false;
    state.showProcessBtn = true;
    
    updateStatus('Image capturée - Prêt pour l\'analyse', 'success');
  }

  async function processOCR(): Promise<void> {
    if (!state.capturedImage) return;

    try {
      updateStatus('Analyse OCR en cours...', 'info');
      state.showLoader = true;
      state.processBtnDisabled = true;
      state.showResult = false;

      const result = await Tesseract.recognize(
        state.capturedImage,
        'fra+eng',
        {
          logger: (m: Tesseract.LoggerMessage) => {
            if (m.status === 'recognizing text') {
              updateStatus(`OCR en cours: ${Math.round(m.progress * 100)}%`, 'info');
            }
          }
        }
      );

      state.extractedText = result.data.text.trim();
      
      if (state.extractedText) {
        state.showResult = true;
        state.showSpeakBtn = true;
        updateStatus('Texte extrait avec succès!', 'success');
      } else {
        updateStatus('Aucun texte détecté dans l\'image', 'error');
      }

      state.showLoader = false;
      state.processBtnDisabled = false;
      
    } catch (err) {
      const error = err as Error;
      updateStatus('Erreur lors de l\'OCR: ' + error.message, 'error');
      state.showLoader = false;
      state.processBtnDisabled = false;
    }
  }

  function speakText(): void {
    if (!state.extractedText) {
      updateStatus('Aucun texte à lire', 'error');
      return;
    }

    if (!('speechSynthesis' in window)) {
      updateStatus('Synthèse vocale non supportée', 'error');
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(state.extractedText);
    utterance.lang = 'fr-FR';
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onstart = () => {
      updateStatus('Lecture en cours...', 'info');
    };

    utterance.onend = () => {
      updateStatus('Lecture terminée', 'success');
    };

    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      updateStatus('Erreur de synthèse vocale: ' + event.error, 'error');
    };

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      updateStatus('Lecture arrêtée', 'info');
    } else {
      window.speechSynthesis.speak(utterance);
    }
  }

  onDestroy(() => {
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  });
</script>

<div class="container">
  <h1>📸 OCR Scanner PWA</h1>
  
  <div class="status status-{state.statusType}">
    {state.statusMessage}
  </div>

  <div class="camera-container">
    <!-- svelte-ignore a11y-media-has-caption -->
    <video 
      bind:this={video} 
      autoplay 
      playsinline 
      class:hidden={!state.showVideo}
    ></video>
    <canvas bind:this={canvas} class="hidden"></canvas>
    <img 
      bind:this={preview} 
      class="image-preview" 
      class:hidden={!state.showPreview} 
      alt="Preview" 
    />
  </div>

  {#if !state.showVideo && !state.showPreview}
    <button class="btn btn-primary" on:click={startCamera}>
      📷 Démarrer la caméra
    </button>
  {/if}
  
  {#if state.showCaptureBtn}
    <button class="btn btn-success" on:click={captureImage}>
      📸 Capturer l'image
    </button>
  {/if}

  {#if state.showProcessBtn}
    <button 
      class="btn btn-primary" 
      on:click={processOCR} 
      disabled={state.processBtnDisabled}
    >
      🔍 Analyser avec OCR
    </button>
  {/if}

  {#if state.showSpeakBtn}
    <button class="btn btn-primary" on:click={speakText}>
      🔊 Lire le texte
    </button>
  {/if}

  {#if state.showLoader}
    <div class="loader"></div>
  {/if}

  {#if state.showResult}
    <div class="result">
      <h3>📄 Texte extrait :</h3>
      <p>{state.extractedText}</p>
    </div>
  {/if}
</div>

<style>
  .container {
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
    background: white;
    border-radius: 20px;
    margin-top: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  }

  h1 {
    color: #4F46E5;
    text-align: center;
    margin-bottom: 30px;
    font-size: 28px;
  }

  .camera-container {
    position: relative;
    width: 100%;
    margin-bottom: 20px;
  }

  video, .image-preview {
    width: 100%;
    border-radius: 10px;
    background: #000;
  }

  canvas {
    display: none;
  }

  .hidden {
    display: none;
  }

  .btn {
    width: 100%;
    padding: 15px;
    border: none;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 10px;
    transition: all 0.3s;
  }

  .btn-primary {
    background: #4F46E5;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #4338CA;
    transform: translateY(-2px);
  }

  .btn-success {
    background: #10B981;
    color: white;
  }

  .btn-success:hover {
    background: #059669;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status {
    padding: 15px;
    border-radius: 10px;
    margin-bottom: 20px;
    font-size: 14px;
  }

  .status-info {
    background: #DBEAFE;
    color: #1E40AF;
  }

  .status-success {
    background: #D1FAE5;
    color: #065F46;
  }

  .status-error {
    background: #FEE2E2;
    color: #991B1B;
  }

  .result {
    margin-top: 20px;
    padding: 20px;
    background: #F9FAFB;
    border-radius: 10px;
    max-height: 300px;
    overflow-y: auto;
  }

  .result h3 {
    color: #4F46E5;
    margin-bottom: 10px;
  }

  .result p {
    line-height: 1.6;
    color: #374151;
    white-space: pre-wrap;
  }

  .loader {
    border: 4px solid #f3f3f3;
    border-top: 4px solid #4F46E5;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    animation: spin 1s linear infinite;
    margin: 20px auto;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style>