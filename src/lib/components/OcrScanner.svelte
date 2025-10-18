<script lang="ts">
  import { browser } from '$app/environment';
  import Tesseract from 'tesseract.js';

  // Variables réactives Svelte 5
  let video = $state<HTMLVideoElement>();
  let canvas = $state<HTMLCanvasElement>();
  let audioElement = $state<HTMLAudioElement>();

  // État simplifié
  let stream = $state<MediaStream | null>(null);
  let extractedText = $state('');
  let rawOcrText = $state('');
  let statusMessage = $state('');
  let progressPercent = $state(0);
  
  // États du workflow
  type AppState = 'camera' | 'processing' | 'ready' | 'playing' | 'paused';
  let appState = $state<AppState>('camera');
  
  let audioUrl = $state<string | null>(null);
  let debugLeftImage = $state<string | null>(null);
  let debugRightImage = $state<string | null>(null);
  let showDebug = $state(false);

  // Démarrer la caméra automatiquement
  async function initCamera(): Promise<void> {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      stream = mediaStream;
      appState = 'camera';
    } catch (err) {
      console.error('Erreur caméra:', err);
      statusMessage = 'Erreur caméra: ' + (err as Error).message;
    }
  }

  // Capturer et tout traiter
  async function startProcessing(): Promise<void> {
    if (!canvas || !video) return;
    
    appState = 'processing';
    statusMessage = 'Capture en cours...';
    progressPercent = 0;

    try {
      // 1. CAPTURER
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const capturedImage = canvas.toDataURL('image/jpeg', 0.95);
      
      // Arrêter la caméra
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }

      progressPercent = 10;

      // 2. DIVISER L'IMAGE
      statusMessage = 'Découpage des pages...';
      const [leftPageImg, rightPageImg] = await splitImageInTwo(capturedImage);
      debugLeftImage = leftPageImg;
      debugRightImage = rightPageImg;
      progressPercent = 15;

      // 3. PRÉTRAITER LES IMAGES
      statusMessage = 'Amélioration de la qualité...';
      const processedLeft = await preprocessImage(leftPageImg);
      const processedRight = await preprocessImage(rightPageImg);
      progressPercent = 20;

      // 4. OCR PAGE GAUCHE
      statusMessage = 'Lecture page gauche...';
      const leftResult = await Tesseract.recognize(processedLeft, 'fra+eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            progressPercent = 20 + Math.round(m.progress * 30);
          }
        }
      });
      const leftText = leftResult.data.text.trim();
      console.log('📄 PAGE GAUCHE (longueur):', leftText.length);
      console.log('📄 PAGE GAUCHE (début):', leftText.substring(0, 150));

      // 5. OCR PAGE DROITE
      statusMessage = 'Lecture page droite...';
      const rightResult = await Tesseract.recognize(processedRight, 'fra+eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            progressPercent = 50 + Math.round(m.progress * 30);
          }
        }
      });
      const rightText = rightResult.data.text.trim();
      console.log('📄 PAGE DROITE (longueur):', rightText.length);
      console.log('📄 PAGE DROITE (début):', rightText.substring(0, 150));

      const rawText = leftText + '\n\n=== SÉPARATION PAGE GAUCHE/DROITE ===\n\n' + rightText;
      rawOcrText = rawText;
      console.log('📦 TEXTE COMBINÉ (longueur totale):', rawText.length);
      progressPercent = 75;

      // 6. NETTOYER AVEC GROQ
      statusMessage = 'Nettoyage du texte...';
      const cleanResponse = await fetch('/api/clean-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText, isDoublePage: true })
      });

      if (cleanResponse.ok) {
        const { cleanedText } = await cleanResponse.json();
        extractedText = cleanedText;
      } else {
        extractedText = rawText;
      }

      progressPercent = 100;
      statusMessage = 'Texte extrait - Cliquez pour lire';
      appState = 'ready';

    } catch (err) {
      console.error('Erreur:', err);
      statusMessage = 'Erreur: ' + (err as Error).message;
      appState = 'camera';
      await initCamera();
    }
  }

  // Générer et lire l'audio
  async function playAudio(): Promise<void> {
    if (!extractedText) return;

    try {
      if (appState === 'paused' && audioElement) {
        // Reprendre la lecture
        await audioElement.play();
        appState = 'playing';
        return;
      }

      // Générer l'audio si pas déjà fait
      if (!audioUrl) {
        statusMessage = 'Génération audio...';
        
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: extractedText })
        });

        if (!response.ok) {
          throw new Error('Erreur génération audio');
        }

        const blob = await response.blob();
        audioUrl = URL.createObjectURL(blob);
      }

      // Lire
      if (audioElement && audioUrl) {
        audioElement.src = audioUrl;
        await audioElement.play();
        appState = 'playing';
        statusMessage = 'Lecture en cours';
      }

    } catch (err) {
      console.error('Erreur audio:', err);
      statusMessage = 'Erreur: ' + (err as Error).message;
    }
  }

  // Pause
  function pauseAudio(): void {
    if (audioElement) {
      audioElement.pause();
      appState = 'paused';
      statusMessage = 'En pause';
    }
  }

  // Recommencer
  function restart(): void {
    extractedText = '';
    rawOcrText = '';
    statusMessage = '';
    progressPercent = 0;
    
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    
    if (audioElement) {
      audioElement.pause();
      audioElement.src = '';
    }
    
    initCamera();
  }

  // Fin de lecture
  function handleAudioEnd(): void {
    appState = 'ready';
    statusMessage = 'Lecture terminée';
  }

  // Gestion des clics tactiles
  function handleScreenClick(event: MouseEvent): void {
    // Ignorer les événements tactiles
    if (event.type === 'touchend' || event.type === 'touchstart') {
      return;
    }

    if (appState === 'camera') {
      // En mode caméra, cliquer n'importe où lance le traitement OCR uniquement
      startProcessing();
    } else if (appState === 'ready' || appState === 'paused') {
      // En mode ready ou pause, cliquer n'importe où lance/reprend l'audio
      playAudio();
    } else if (appState === 'playing') {
      // En lecture, cliquer met en pause
      pauseAudio();
    }
  }

  // Gestion du clic droit pour relancer l'analyse
  async function handleContextMenu(event: MouseEvent): Promise<void> {
    event.preventDefault(); // Empêche le menu contextuel

    // Ignorer les événements tactiles
    if (event.type.includes('touch')) {
      return;
    }

    // Si on est en lecture/pause/ready, on relance directement le traitement
    if (appState === 'ready' || appState === 'playing' || appState === 'paused') {
      // Nettoyer l'ancien audio
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        audioUrl = null;
      }
      if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
      }
      
      extractedText = '';
      rawOcrText = '';
      statusMessage = 'Préparation de la nouvelle capture...';
      progressPercent = 0;
      
      // Relancer caméra silencieusement
      await initCamera();
      
      // Attendre que la caméra soit stable puis lancer le traitement automatiquement
      setTimeout(() => {
        startProcessing();
      }, 800);
    }
  }

  // Améliorer la qualité de l'image pour l'OCR
  async function preprocessImage(imageDataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      
      img.onload = () => {
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');
        if (!ctx) return resolve(imageDataUrl);
        
        // Augmenter la résolution
        const scale = 2;
        tempCanvas.width = img.width * scale;
        tempCanvas.height = img.height * scale;
        
        // Appliquer des filtres pour améliorer la lisibilité
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);
        
        // Augmenter le contraste
        const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        
        const factor = 1.5; // Facteur de contraste
        const intercept = 128 * (1 - factor);
        
        for (let i = 0; i < data.length; i += 4) {
          data[i] = data[i] * factor + intercept;     // R
          data[i + 1] = data[i + 1] * factor + intercept; // G
          data[i + 2] = data[i + 2] * factor + intercept; // B
        }
        
        ctx.putImageData(imageData, 0, 0);
        
        resolve(tempCanvas.toDataURL('image/jpeg', 1.0));
      };
      
      img.src = imageDataUrl;
    });
  }

  // Diviser l'image
  function splitImageInTwo(imageDataUrl: string): Promise<[string, string]> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        const tempCanvas = document.createElement('canvas');
        const ctx = tempCanvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Canvas error'));
          return;
        }
        
        const halfWidth = Math.floor(img.width / 2);
        
        tempCanvas.width = halfWidth;
        tempCanvas.height = img.height;
        ctx.drawImage(img, 0, 0, halfWidth, img.height, 0, 0, halfWidth, img.height);
        const leftPage = tempCanvas.toDataURL('image/jpeg', 0.95);
        
        ctx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(img, halfWidth, 0, halfWidth, img.height, 0, 0, halfWidth, img.height);
        const rightPage = tempCanvas.toDataURL('image/jpeg', 0.95);
        
        resolve([leftPage, rightPage]);
      };
      
      img.onerror = () => reject(new Error('Image error'));
      img.src = imageDataUrl;
    });
  }

  // Effect pour la caméra
  $effect(() => {
    if (video && stream && appState === 'camera') {
      video.srcObject = stream;
      video.play().catch(err => console.error('Play error:', err));
    }
  });

  // Cleanup
  $effect(() => {
    return () => {
      if (browser && stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  });

  // Démarrer la caméra au chargement
  if (browser) {
    initCamera();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="app" onclick={handleScreenClick} oncontextmenu={handleContextMenu}>
  <!-- Caméra plein écran -->
  {#if appState === 'camera'}
    <div class="camera-fullscreen">
      <!-- svelte-ignore a11y_missing_attribute -->
      <video bind:this={video} autoplay playsinline></video>
      <div class="center-line"></div>
      <canvas bind:this={canvas} class="hidden"></canvas>
      
      <div class="camera-hint">
        <p class="hint-text">👆 Cliquez n'importe où pour capturer</p>
      </div>
    </div>
  {/if}

  <!-- Processing -->
  {#if appState === 'processing'}
    <div class="processing-screen">
      <div class="loader"></div>
      <h2>{statusMessage}</h2>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {progressPercent}%"></div>
      </div>
      <p class="progress-text">{progressPercent}%</p>
    </div>
  {/if}

  <!-- Texte + Lecture -->
  {#if appState === 'ready' || appState === 'playing' || appState === 'paused'}
    <div class="result-screen">
      <div class="header">
        <h1>📖 Texte extrait</h1>
        <div class="header-buttons">
          <button 
            class="btn-small" 
            onclick={(e) => { 
              e.stopPropagation(); 
              showDebug = !showDebug; 
            }}
          >
            {showDebug ? '👁️ Masquer debug' : '🔍 Debug'}
          </button>
          <button 
            class="btn-small" 
            onclick={(e) => { 
              e.stopPropagation(); 
              restart(); 
            }}
          >
            🔄 Recommencer
          </button>
        </div>
      </div>

      {#if showDebug && debugLeftImage && debugRightImage}
        <div class="debug-section">
          <h3>🔍 Images découpées :</h3>
          <div class="debug-images">
            <div class="debug-image-container">
              <p><strong>Page GAUCHE</strong></p>
              <img src={debugLeftImage} alt="Page gauche" />
            </div>
            <div class="debug-image-container">
              <p><strong>Page DROITE</strong></p>
              <img src={debugRightImage} alt="Page droite" />
            </div>
          </div>
          <div class="debug-text">
            <p><strong>Texte brut OCR :</strong></p>
            <pre>{rawOcrText}</pre>
          </div>
        </div>
      {/if}

      <div class="text-display">
        <p>{extractedText}</p>
      </div>

      <div class="click-hint">
        {#if appState === 'ready'}
          <p class="hint-text">👆 Clic gauche : lire l'audio | Clic droit : nouvelle page</p>
          <p class="audio-warning">⚠️ Audio consomme des tokens</p>
        {:else if appState === 'playing'}
          <p class="hint-text">👆 Clic gauche : pause | Clic droit : nouvelle page</p>
        {:else if appState === 'paused'}
          <p class="hint-text">👆 Clic gauche : reprendre | Clic droit : nouvelle page</p>
        {/if}
      </div>

      {#if statusMessage}
        <p class="status-small">{statusMessage}</p>
      {/if}
    </div>
  {/if}

  <audio 
    bind:this={audioElement}
    onended={handleAudioEnd}
    class="hidden"
  ></audio>
</div>

<style>
  .app {
    position: fixed;
    inset: 0;
    background: #000;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .camera-fullscreen {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 40px;
  }

  video {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .center-line {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 2px;
    background: white;
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.8),
                0 0 16px rgba(255, 255, 255, 0.4);
    transform: translateX(-50%);
    z-index: 10;
  }

  .center-line::before,
  .center-line::after {
    content: '';
    position: absolute;
    left: 50%;
    width: 40px;
    height: 2px;
    background: white;
    transform: translateX(-50%);
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
  }

  .center-line::before {
    top: 20%;
  }

  .center-line::after {
    bottom: 20%;
  }

  .camera-hint {
    position: relative;
    z-index: 20;
    text-align: center;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(10px);
    padding: 20px 40px;
    border-radius: 20px;
  }

  .camera-hint .hint-text {
    color: white;
    margin: 0;
  }

  .processing-screen {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .loader {
    width: 80px;
    height: 80px;
    border: 8px solid rgba(255, 255, 255, 0.2);
    border-top: 8px solid white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 30px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .processing-screen h2 {
    font-size: 24px;
    margin-bottom: 30px;
    text-align: center;
  }

  .progress-bar {
    width: 100%;
    max-width: 400px;
    height: 8px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 10px;
  }

  .progress-fill {
    height: 100%;
    background: white;
    transition: width 0.3s;
    border-radius: 10px;
  }

  .progress-text {
    font-size: 20px;
    font-weight: 600;
  }

  .result-screen {
    width: 100%;
    height: 100%;
    background: white;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .header h1 {
    font-size: 24px;
    margin: 0;
  }

  .header-buttons {
    display: flex;
    gap: 10px;
  }

  .btn-small {
    padding: 10px 20px;
    background: rgba(255, 255, 255, 0.2);
    color: white;
    border: 2px solid white;
    border-radius: 20px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
  }

  .btn-small:hover {
    background: white;
    color: #667eea;
  }

  .text-display {
    flex: 1;
    overflow-y: auto;
    padding: 30px;
    background: #F9FAFB;
  }

  .text-display p {
    line-height: 1.8;
    font-size: 18px;
    color: #374151;
    white-space: pre-wrap;
    max-width: 800px;
    margin: 0 auto;
  }

  .status-small {
    text-align: center;
    padding: 10px;
    color: #6B7280;
    font-size: 14px;
  }

  .click-hint {
    text-align: center;
    padding: 20px;
    margin: 20px 0;
  }

  .hint-text {
    font-size: 20px;
    font-weight: 600;
    color: #667eea;
    animation: bounce 2s infinite;
    margin: 0 0 10px 0;
  }

  .audio-warning {
    font-size: 14px;
    color: #F59E0B;
    font-weight: 600;
    margin: 0;
  }

  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }

  .hidden {
    display: none;
  }

  .debug-section {
    background: #FEF3C7;
    padding: 20px;
    border-bottom: 2px solid #F59E0B;
    max-height: 400px;
    overflow-y: auto;
  }

  .debug-section h3 {
    margin: 0 0 15px 0;
    color: #92400E;
  }

  .debug-images {
    display: flex;
    gap: 20px;
    margin-bottom: 20px;
  }

  .debug-image-container {
    flex: 1;
    text-align: center;
  }

  .debug-image-container p {
    margin-bottom: 10px;
    font-weight: 600;
    color: #92400E;
  }

  .debug-image-container img {
    width: 100%;
    border: 2px solid #F59E0B;
    border-radius: 8px;
  }

  .debug-text {
    margin-top: 20px;
  }

  .debug-text p {
    font-weight: 600;
    margin-bottom: 10px;
    color: #92400E;
  }

  .debug-text pre {
    background: white;
    padding: 15px;
    border-radius: 8px;
    overflow-x: auto;
    font-size: 12px;
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 200px;
    overflow-y: auto;
  }
</style>