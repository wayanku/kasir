// File: /Users/user/kasir-1/absensi.js

let absensiStream = null;
let isAbsensiModelLoaded = false;
let faceMatcher = null;
let isDetecting = false;
let livenessChallenge = null; // 'smile' | 'blink' | 'turn_left' | 'turn_right'
let livenessTimer = null;
let livenessQueue = []; // [BARU] Antrian tantangan beruntun

// [BARU] Helper Matematika untuk Liveness (Anti-Spoofing)
function getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function getEAR(points) {
    // EAR (Eye Aspect Ratio) untuk deteksi kedip
    const A = getDistance(points[1], points[5]);
    const B = getDistance(points[2], points[4]);
    const C = getDistance(points[0], points[3]);
    return (A + B) / (2.0 * C);
}

// [BARU] Helper Hitung Jarak GPS (Haversine Formula)
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius bumi (km)
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
        Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c;
}

function deg2rad(deg) {
    return deg * (Math.PI/180);
}

// Load Model Wajah dari CDN Publik
async function initAbsensiSystem() {
    if (isAbsensiModelLoaded) return;
    
    // Menggunakan model dari repo publik face-api.js
    const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
    
    const statusEl = document.getElementById('absensi-status');
    
    // Cek koneksi untuk memberi feedback yang tepat
    if (!navigator.onLine) {
        if(statusEl) statusEl.innerText = "Mode Offline: Mencoba memuat AI dari cache...";
    } else {
        if(statusEl) statusEl.innerText = "Sedang Mengunduh Model AI (Anti-Spoofing)...";
    }

    try {
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL)
        ]);
        
        isAbsensiModelLoaded = true;
        
        // Indikator Sukses & Siap Offline
        if(statusEl) {
            statusEl.innerHTML = `
                <span class="flex items-center gap-2 text-emerald-600">
                    <span class="relative flex h-2 w-2">
                      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Sistem Siap (Offline Support Aktif)
                </span>`;
        }
        loadRegisteredFaces();
        console.log("Model Wajah Berhasil Dimuat");
    } catch (error) {
        console.error("Gagal memuat model:", error);
        
        const msg = !navigator.onLine ? "Gagal: Butuh internet untuk penggunaan pertama kali." : "Gagal memuat model wajah.";
        showToast(msg, "error");
        if(statusEl) statusEl.innerHTML = `<span class='text-red-500 font-bold'>${msg}</span>`;
    }
}

function loadRegisteredFaces() {
    const data = JSON.parse(localStorage.getItem('registered_faces')) || [];
    if (data.length > 0) {
        const labeledDescriptors = data.map(d => {
            return new faceapi.LabeledFaceDescriptors(
                d.label,
                d.descriptors.map(desc => new Float32Array(desc))
            );
        });
        faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
    }
}

async function startAbsensiCamera() {
    await initAbsensiSystem();
    
    const video = document.getElementById('video-absensi');
    if (!video) return;

    try {
        absensiStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        video.srcObject = absensiStream;
        
        video.onloadedmetadata = () => {
            video.play();
            detectFrame();
        };
    } catch (err) {
        console.error(err);
        showToast("Gagal akses kamera depan!", "error");
    }
}

function stopAbsensiCamera() {
    isDetecting = false;
    livenessChallenge = null; // Reset challenge
    livenessQueue = []; // Reset queue
    if (absensiStream) {
        absensiStream.getTracks().forEach(track => track.stop());
        absensiStream = null;
    }
    const video = document.getElementById('video-absensi');
    if(video) video.srcObject = null;
    
    updateUIForCameraStop(); // [BARU] Reset UI

    // Clear canvas
    const canvas = document.getElementById('canvas-absensi-overlay');
    if(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

async function detectFrame() {
    const video = document.getElementById('video-absensi');
    const canvas = document.getElementById('canvas-absensi-overlay');
    const statusEl = document.getElementById('absensi-status');
    
    if (!video || !canvas || video.paused || video.ended || !isAbsensiModelLoaded) return;

    isDetecting = true;

    // Sesuaikan ukuran canvas dengan video
    const displaySize = { width: video.offsetWidth, height: video.offsetHeight };
    faceapi.matchDimensions(canvas, displaySize);

    const loop = async () => {
        if (!isDetecting) return;

        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceExpressions()
            .withFaceDescriptors();

        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        
        // Clear canvas
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (resizedDetections.length > 0) {
            const detection = resizedDetections[0];
            const box = detection.detection.box;
            
            // Gambar kotak wajah
            new faceapi.draw.DrawBox(box, { label: 'Wajah Terdeteksi' }).draw(canvas);

            // Mode Pendaftaran
            if (window.absensiMode === 'register') {
                statusEl.innerText = "Wajah terdeteksi. Klik 'Simpan Wajah' untuk mendaftar.";
                window.currentDescriptor = detection.descriptor;
            } 
            // Mode Absensi (Verifikasi)
            else if (window.absensiMode === 'verify') {
                if (!faceMatcher) {
                    statusEl.innerText = "Belum ada wajah terdaftar!";
                    return;
                }

                const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
                
                if (bestMatch.label !== 'unknown') {
                    // Liveness Check (Deteksi Hidup)
                    if (!livenessChallenge) {
                        startLivenessChallenge();
                    } else {
                        // Pass full detection object (landmarks needed for blink/turn)
                        checkLiveness(detection, bestMatch.label);
                    }
                } else {
                    statusEl.innerText = "Wajah tidak dikenali.";
                    livenessChallenge = null;
                }
            }
        } else {
            statusEl.innerText = "Arahkan wajah ke kamera...";
            livenessChallenge = null;
        }

        if (isDetecting) requestAnimationFrame(loop);
    };

    loop();
}

// [BARU] Challenge Acak untuk Anti-Spoofing
function startLivenessChallenge() {
    // Generate 2 tantangan unik secara berurutan (Combo)
    const challenges = ['smile', 'blink', 'turn_left', 'turn_right'];
    livenessQueue = [];
    
    while(livenessQueue.length < 2) {
        const c = challenges[Math.floor(Math.random() * challenges.length)];
        // Pastikan tantangan kedua beda dengan pertama
        if(livenessQueue.length === 0 || livenessQueue[livenessQueue.length-1] !== c) {
            livenessQueue.push(c);
        }
    }
    
    processNextChallenge();
}

function processNextChallenge() {
    livenessChallenge = livenessQueue[0];
    
    const statusEl = document.getElementById('absensi-status');
    let msg = "";
    let voiceMsg = "";
    const stepInfo = livenessQueue.length === 2 ? "(1/2)" : "(2/2)"; // Indikator langkah

    switch(livenessChallenge) {
        case 'smile':
            msg = `MOHON TERSENYUM ${stepInfo} 😊`;
            voiceMsg = "Mohon tersenyum";
            break;
        case 'blink':
            msg = `MOHON KEDIPKAN MATA ${stepInfo} 😉`;
            voiceMsg = "Mohon kedipkan mata";
            break;
        case 'turn_left':
            msg = `TOLEH KE KIRI ${stepInfo} ⬅️`;
            voiceMsg = "Toleh ke kiri";
            break;
        case 'turn_right':
            msg = `TOLEH KE KANAN ${stepInfo} ➡️`;
            voiceMsg = "Toleh ke kanan";
            break;
    }
    
    statusEl.innerHTML = `<span class='text-orange-600 font-bold animate-pulse'>${msg}</span>`;
    if(typeof ucapkan === 'function') ucapkan(voiceMsg);
}

function checkLiveness(detection, label) {
    if (livenessChallenge === 'waiting') return; // Abaikan frame saat transisi

    const statusEl = document.getElementById('absensi-status');
    const expressions = detection.expressions;
    const landmarks = detection.landmarks;
    const positions = landmarks.positions; // Array 68 titik wajah

    let isPassed = false;
    
    if (livenessChallenge === 'smile') {
        if (expressions.happy > 0.7) isPassed = true;
    } 
    else if (livenessChallenge === 'blink') {
        // Mata Kiri: 36-41, Mata Kanan: 42-47
        const leftEye = positions.slice(36, 42);
        const rightEye = positions.slice(42, 48);
        const avgEAR = (getEAR(leftEye) + getEAR(rightEye)) / 2;
        
        // Threshold kedip (mata tertutup)
        if (avgEAR < 0.25) isPassed = true;
    }
    else if (livenessChallenge === 'turn_left' || livenessChallenge === 'turn_right') {
        // Estimasi Pose Kepala (Nose vs Jaw)
        const noseX = positions[30].x; // Ujung hidung
        const jawLeftX = positions[0].x;
        const jawRightX = positions[16].x;
        const faceWidth = jawRightX - jawLeftX;
        
        if (faceWidth > 0) {
            const ratio = (noseX - jawLeftX) / faceWidth;
            // Ratio ~0.5 = Depan
            // Ratio < 0.4 = Menoleh Kanan (Hidung mendekati pipi kiri di frame)
            // Ratio > 0.6 = Menoleh Kiri (Hidung mendekati pipi kanan di frame)
            
            if (livenessChallenge === 'turn_left' && ratio > 0.6) isPassed = true; 
            if (livenessChallenge === 'turn_right' && ratio < 0.4) isPassed = true;
        }
    }

    if (isPassed) {
        livenessQueue.shift(); // Hapus tantangan yang sudah selesai
        
        if (livenessQueue.length > 0) {
            // Masih ada tantangan berikutnya
            statusEl.innerHTML = `<span class='text-blue-600 font-bold'>BAGUS! TAHAN SEBENTAR...</span>`;
            livenessChallenge = 'waiting'; // Pause sebentar
            if(typeof ucapkan === 'function') ucapkan("Bagus");
            
            setTimeout(() => {
                processNextChallenge();
            }, 1000);
        } else {
            // Semua tantangan selesai -> SUKSES
            // [BARU] Cek Lokasi GPS sebelum finalisasi
            verifyLocationAndFinish(label);
        }
    }
}

function verifyLocationAndFinish(label) {
    const statusEl = document.getElementById('absensi-status');
    
    // Cek apakah toko punya setting lokasi
    if (typeof profilToko !== 'undefined' && profilToko.lokasi && profilToko.lokasi.lat) {
        statusEl.innerHTML = `<span class='text-blue-600 font-bold animate-pulse'>Memverifikasi Lokasi GPS...</span>`;
        
        if(!navigator.geolocation) {
            statusEl.innerHTML = `<span class='text-red-600 font-bold'>GPS Tidak Aktif! Absensi Ditolak.</span>`;
            return;
        }

        navigator.geolocation.getCurrentPosition(pos => {
            const dist = getDistanceFromLatLonInKm(pos.coords.latitude, pos.coords.longitude, profilToko.lokasi.lat, profilToko.lokasi.lng);
            const radiusKm = 0.05; // 50 meter
            
            if (dist <= radiusKm) {
                finalizeAbsensi(label);
            } else {
                statusEl.innerHTML = `<span class='text-red-600 font-bold'>LOKASI TIDAK SESUAI! (${(dist*1000).toFixed(0)}m dari toko)</span>`;
                if(typeof ucapkan === 'function') ucapkan("Lokasi tidak sesuai.");
            }
        }, err => {
            statusEl.innerHTML = `<span class='text-red-600 font-bold'>Gagal Deteksi Lokasi: ${err.message}</span>`;
        }, { enableHighAccuracy: true, timeout: 5000 });
    } else {
        // Jika toko belum set lokasi, loloskan saja (atau bisa ditolak jika ingin strict)
        finalizeAbsensi(label);
    }
}

function finalizeAbsensi(label) {
    const statusEl = document.getElementById('absensi-status');
    statusEl.innerHTML = `<span class='text-green-600 font-bold'>VERIFIKASI BERHASIL! Halo ${label}</span>`;
    catatAbsensi(label);
    isDetecting = false; 
    livenessChallenge = null;
    if(typeof ucapkan === 'function') ucapkan(`Terima kasih ${label}, absensi berhasil.`);
    
    setTimeout(() => {
        stopAbsensiCamera();
        if(typeof renderRiwayatAbsensi === 'function') renderRiwayatAbsensi();
        // UI reset handled by stopAbsensiCamera -> updateUIForCameraStop
    }, 2000);
}

// [BARU] Helper UI
function updateUIForCameraStart() {
    const placeholder = document.getElementById('absensi-placeholder');
    if(placeholder) placeholder.classList.add('hidden');
    
    document.getElementById('container-kamera-absensi').classList.remove('hidden');
    
    // Hide main buttons to focus
    document.getElementById('btn-mulai-absensi').classList.add('hidden');
    document.getElementById('btn-daftar-wajah').classList.add('hidden');
}

function updateUIForCameraStop() {
    const placeholder = document.getElementById('absensi-placeholder');
    if(placeholder) placeholder.classList.remove('hidden');
    
    document.getElementById('container-kamera-absensi').classList.add('hidden');
    
    // Show main buttons
    document.getElementById('btn-mulai-absensi').classList.remove('hidden');
    document.getElementById('btn-daftar-wajah').classList.remove('hidden');
    document.getElementById('btn-simpan-wajah').classList.add('hidden');
}

// Fungsi Publik untuk UI
function modeDaftarWajah() {
    const nama = prompt("Masukkan Nama Karyawan:");
    if (!nama) return;
    
    window.absensiMode = 'register';
    window.registerName = nama;
    window.currentDescriptor = null;
    
    updateUIForCameraStart();
    document.getElementById('btn-simpan-wajah').classList.remove('hidden');
    
    startAbsensiCamera();
}

function modeMulaiAbsensi() {
    if (!faceMatcher) {
        loadRegisteredFaces();
        if (!faceMatcher) return showToast("Belum ada data wajah. Daftarkan dulu.", "error");
    }

    window.absensiMode = 'verify';
    updateUIForCameraStart();
    // btn-simpan-wajah tetap hidden (default)
    
    startAbsensiCamera();
}

function simpanWajahBaru() {
    if (!window.currentDescriptor) {
        return showToast("Wajah tidak terdeteksi!", "error");
    }
    
    const data = JSON.parse(localStorage.getItem('registered_faces')) || [];
    // Simpan descriptor sebagai array biasa (bukan Float32Array agar bisa di-JSON-kan)
    data.push({
        label: window.registerName,
        descriptors: [Array.from(window.currentDescriptor)]
    });
    
    localStorage.setItem('registered_faces', JSON.stringify(data));
    loadRegisteredFaces(); // Reload matcher
    
    showToast(`Wajah ${window.registerName} berhasil didaftarkan!`, "success");
    stopAbsensiCamera();
}

function batalAbsensi() {
    stopAbsensiCamera();
}

function catatAbsensi(nama) {
    // Gunakan variabel global absensiLog dari app.js jika memungkinkan, atau load sendiri
    let logs = JSON.parse(localStorage.getItem('absensi_log')) || [];
    logs.unshift({
        waktu: new Date().toISOString(),
        user: nama,
        foto: 'Verified by AI', // Tidak perlu simpan foto base64 berat
        metode: 'Face ID'
    });
    localStorage.setItem('absensi_log', JSON.stringify(logs));
    // Trigger update UI di app.js jika ada
    if (typeof renderRiwayatAbsensi === 'function') renderRiwayatAbsensi();
}
