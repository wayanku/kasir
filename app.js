// [MUTAKHIR] Global Error Guard (Mencegah White Screen)
window.onerror = function(msg, url, line, col, error) {
    console.error("Global Error:", msg, error);
    // Jangan tampilkan alert jika error sepele/network
    if (msg.includes('Script error') || msg.includes('network')) return;
    showToast("Terjadi kesalahan sistem. Data aman.", "error");
    return true; // Prevent default handler
};

// [OPTIMASI] Helper Load Script Dinamis (Lazy Load)
// Library hanya didownload saat fitur dipakai, membuat aplikasi SANGAT RINGAN di awal.
const loadedScripts = {};
function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (loadedScripts[src] || document.querySelector(`script[src="${src}"]`)) return resolve();
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => { loadedScripts[src] = true; resolve(); };
        script.onerror = () => reject(new Error(`Gagal load ${src}`));
        document.head.appendChild(script);
    });
}

// REGISTER SERVICE WORKER (Agar bisa jalan Offline)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Aplikasi siap offline'))
            .catch(err => console.log('Gagal register SW', err));
    });
}

let gudang = JSON.parse(localStorage.getItem('gudang_data')) || [];
let riwayat = JSON.parse(localStorage.getItem('riwayat_transaksi')) || [];
let pelanggan = JSON.parse(localStorage.getItem('pelanggan_data')) || [];
let pendingCarts = JSON.parse(localStorage.getItem('pending_carts')) || [];
let stockLog = JSON.parse(localStorage.getItem('stock_log')) || [];
let stokOpnameLog = JSON.parse(localStorage.getItem('stok_opname_log')) || []; // [BARU] Log Stok Opname
let activeShift = JSON.parse(localStorage.getItem('active_shift')) || null; // [BARU] Shift Aktif
let shiftLog = JSON.parse(localStorage.getItem('shift_log')) || []; // [BARU] Riwayat Shift
let users = JSON.parse(localStorage.getItem('app_users')) || [
    { id: 'OWNER', nama: 'Owner', role: 'admin', pin: '123456' },
    { id: 'KASIR', nama: 'Kasir', role: 'kasir', pin: '1234' }
];
let currentUser = JSON.parse(sessionStorage.getItem('logged_user')) || null;
let absensiLog = JSON.parse(localStorage.getItem('absensi_log')) || []; // [BARU] Log Absensi
let pengeluaran = JSON.parse(localStorage.getItem('pengeluaran_data')) || []; // [BARU] Data Arus Kas (Masuk/Keluar)
let vouchers = JSON.parse(localStorage.getItem('vouchers_data')) || []; // [BARU] Data Voucher
let settings = JSON.parse(localStorage.getItem('app_settings')) || { targetOmzet: 500000, pointMultiplier: 10000, pointExchangeValue: 1, memberLevels: { silver: { pts: 100, disc: 5 }, gold: { pts: 500, disc: 10 } }, liteMode: false }; // [BARU] App Settings
if(!settings.pointExchangeValue) settings.pointExchangeValue = 1; // Default backward compatibility
let mejaData = JSON.parse(localStorage.getItem('meja_data')) || Array.from({length: 9}, (_, i) => ({ id: i+1, status: 'kosong', pesanan: [] })); // [BARU] Data Meja (Default 9 meja)
let activeTableId = null; // Meja yang sedang aktif/dipilih
let cart = JSON.parse(localStorage.getItem('current_cart')) || []; // [BARU] Load cart dari storage
let remainingCartItems = []; // [BARU] Untuk split bill retail
let tempCart = []; // Penampung scan sementara
let scanner = null;
let scannerStok = null;
let tempSku = '';
let lastScanCode = null;
let lastScanTime = 0;
let currentTrack = null;
let barcodeBuffer = "";
let barcodeTimer;
let settingPajak = parseFloat(localStorage.getItem('setting_pajak')) || 0;
let tempImageData = null; // [BARU] Penampung data gambar base64 sementara
let tempQrisData = null; // [BARU] Penampung QRIS
let metodePembayaran = 'tunai'; // tunai | nontunai
let stokLimit = 20; // Batas render awal untuk performa
let kasirMode = 'retail'; // 'retail' | 'resto'
let profilToko = JSON.parse(localStorage.getItem('profil_toko')) || {
    nama: 'KASIR PINTAR PRO',
    alamat: 'Jl. Raya Bisnis No. 1',
    nohp: '0812-3456-7890',
    footer: 'Terima Kasih atas Kunjungan Anda',
    infoBayar: '',
    happyHour: { start: '', end: '', percent: 0 }
};
let isProcessingPay = false; // [BARU] Flag untuk mencegah double submit

// --- PWA INSTALL PROMPT ---
let deferredPrompt;
const installContainer = document.getElementById('install-prompt-container');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installContainer.classList.remove('hidden');
  installContainer.classList.add('flex');
});

function promptInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        showToast('Aplikasi berhasil diinstal!', 'success');
        installContainer.classList.add('hidden');
      }
      deferredPrompt = null;
    });
  }
}

// [BARU] Image Handler
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 300;
            const MAX_HEIGHT = 300;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            
            if (dataUrl.length > 2 * 1024 * 1024) { // Batas 2MB per gambar
                return showToast("Ukuran gambar terlalu besar setelah kompresi!", "error");
            }
            document.getElementById('f-gambar-preview').src = dataUrl;
            tempImageData = dataUrl;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// [BARU] QRIS Image Handler
function handleQrisUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 600; 
            let width = img.width;
            let height = img.height;
            if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } } 
            else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            document.getElementById('set-qris-preview').src = dataUrl;
            tempQrisData = dataUrl;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
function hapusQris() { tempQrisData = null; document.getElementById('set-qris-preview').src = 'https://via.placeholder.com/100?text=QRIS'; document.getElementById('file-qris').value = ''; }

// --- PAGE VISIBILITY API & NETWORK STATUS ---
// Fitur profesional untuk mengelola state aplikasi
const updateNetworkStatus = () => {
    const statusDot = document.getElementById('network-status');
    if (!statusDot) return;
    if (navigator.onLine) {
        statusDot.classList.remove('bg-red-500');
        statusDot.classList.add('bg-green-500');
        statusDot.title = 'Online';
    } else {
        statusDot.classList.remove('bg-green-500');
        statusDot.classList.add('bg-red-500');
        statusDot.title = 'Offline';
        showToast('Koneksi internet terputus, aplikasi beralih ke mode offline.', 'info');
    }
};

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

// Hentikan kamera saat app tidak aktif untuk hemat baterai & privasi
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopSemuaKamera();
    }
});

// TOAST NOTIFICATION
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerText = msg;
    
    if(type === 'error') el.style.background = 'rgba(220, 38, 38, 0.9)';
    else if(type === 'success') el.style.background = 'rgba(13, 148, 136, 0.9)'; // teal-600
    else el.style.background = 'rgba(50, 50, 50, 0.9)';
    
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// --- UTILITIES ---
const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
};

// Helper Escape HTML (Keamanan XSS)
const escapeHtml = (text) => {
    if (!text) return text;
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// Helper Format Rupiah
const formatRupiah = (val) => 'Rp ' + parseInt(val || 0).toLocaleString('id-ID');

// [BARU] Helper Jam Digital
function updateClock() {
    const clockEl = document.getElementById('clock');
    if (!clockEl) return;
    const now = new Date();
    const timeString = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateString = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
    clockEl.innerHTML = `${dateString}, <span class="font-mono">${timeString}</span>`;
}

// [BARU] History Management (Back Button Logic)
window.addEventListener('popstate', (event) => {
    // 1. Tutup semua modal jika ada yang terbuka saat back button ditekan
    const modals = document.querySelectorAll('.fixed.inset-0.z-\\[100\\], .fixed.inset-0.z-\\[110\\], .fixed.inset-0.z-\\[150\\], .fixed.inset-0.z-\\[210\\]');
    let modalClosed = false;
    modals.forEach(m => {
        if (!m.classList.contains('hidden')) {
            m.classList.add('hidden');
            m.classList.remove('flex');
            modalClosed = true;
        }
    });
    
    // 2. Stop kamera jika modal scanner tertutup
    if(scanner && scanner.isScanning) {
         try { scanner.stop(); } catch(e) {}
    }

    // 3. Navigasi Halaman
    if (event.state && event.state.page) {
        bukaHalaman(event.state.page, event.state.mode, false); // false = jangan push state lagi
    } else {
        bukaHalaman('dashboard', null, false);
    }
});

// [CANGGIH] Sound FX Engine (Synthesized Audio)
const SoundFX = {
    ctx: null,
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    play(type) {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        const now = this.ctx.currentTime;
        if (type === 'click') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === 'success') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(500, now);
            osc.frequency.linearRampToValueAtTime(1000, now + 0.1);
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'error') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.linearRampToValueAtTime(100, now + 0.2);
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
        } else if (type === 'beep') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(1200, now);
            gain.gain.setValueAtTime(0.05, now);
            osc.start(now);
            osc.stop(now + 0.1);
        }
    }
};

function playBeep() { SoundFX.play('beep'); }

// KEYBOARD LISTENER (USB SCANNER & SHORTCUTS)
document.addEventListener('keydown', (e) => {
    // Shortcuts
    if(e.key === 'F2') { e.preventDefault(); toggleSearch(); return; }
    if(e.key === 'F4' && document.getElementById('p-kasir').classList.contains('active')) { e.preventDefault(); bayarSekarang(); return; }
    if(e.key === 'F8' && !document.getElementById('modal-bayar').classList.contains('hidden')) { e.preventDefault(); document.getElementById('input-uang').focus(); return; }
    
    const activeModal = document.querySelector('#modal-tambah-produk:not(.hidden), #modal-bayar:not(.hidden), #modal-tambah-pelanggan:not(.hidden)');

    // USB Scanner Logic
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Enter' && !document.getElementById('modal-bayar').classList.contains('hidden')) {
            prosesPembayaranFinal();
        }
        return;
    }

    if (e.key === 'Enter') {
        if (barcodeBuffer.length > 0) {
            // Cegah scan jika ada modal terbuka agar tidak mengacaukan state
            if (document.querySelector('.modal:not(.hidden), #modal-bayar:not(.hidden), #modal-split-bill:not(.hidden)')) { barcodeBuffer = ""; return; }
            
            if (document.getElementById('p-kasir').classList.contains('active')) {
                handleScanKasir(barcodeBuffer);
            } else if (document.getElementById('p-stok').classList.contains('active')) {
                document.getElementById('f-sku').value = barcodeBuffer;
                openModalTambahProduk();
            }
            barcodeBuffer = "";
        }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        barcodeBuffer += e.key;
        clearTimeout(barcodeTimer);
        barcodeTimer = setTimeout(() => barcodeBuffer = "", 100); // Increased timeout for slower scanners
    }
});

async function stopSemuaKamera() {
    if(scanner) {
        try {
            if(scanner.isScanning) await scanner.stop();
            scanner.clear();
        } catch(e) { console.log("Stop camera error", e); }
        scanner = null;
    }
}

// KAMERA ENGINE
async function startKamera() {
    document.getElementById('camera-prompt').style.display = 'none';
    
    // [OPTIMASI] Load Library Kamera hanya saat tombol ditekan
    try {
        await loadScript('https://unpkg.com/html5-qrcode');
    } catch(e) {
        return showToast("Gagal memuat modul kamera. Cek internet.", "error");
    }

    if (!scanner) {
        scanner = new Html5Qrcode("reader", { verbose: false });
    }
    
    const config = { 
        fps: 30, // [OPTIMASI] FPS lebih tinggi agar responsif
        aspectRatio: undefined, // [FIX] Biarkan browser menentukan rasio terbaik (cegah kamera gelap di laptop)
        qrbox: 250, // Kotak scan standar
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        }
    };
    
    const onCameraReady = () => {
        const videoEl = document.querySelector('#reader video');
        const track = (videoEl && videoEl.srcObject) ? videoEl.srcObject.getVideoTracks()[0] : null;
        
        if (!track) return;
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        const camControls = document.getElementById('cam-controls');
        
        camControls.classList.remove('hidden');
        camControls.classList.add('flex');

        if (capabilities.zoom) {
            const zoomBox = document.getElementById('zoom-box');
            const zoomSlider = document.getElementById('zoom-slider');
            const zoomValue = document.getElementById('zoom-value');
            zoomBox.classList.remove('hidden');
            zoomSlider.min = capabilities.zoom.min;
            zoomSlider.max = capabilities.zoom.max;
            zoomSlider.step = capabilities.zoom.step;
            
            zoomSlider.oninput = () => {
                const val = zoomSlider.value;
                zoomValue.innerText = parseFloat(val).toFixed(1) + 'x';
                track.applyConstraints({ advanced: [{ zoom: val }] });
            };
        }

        if (capabilities.torch) {
            document.getElementById('btn-flash').classList.remove('hidden');
        }

        // [CANGGIH] Auto Focus Pintar: Hanya aktifkan jika perangkat mendukung
        if (track.applyConstraints && capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
            track.applyConstraints({ 
                advanced: [{ focusMode: "continuous" }] 
            }).catch(e => console.log("Fitur fokus otomatis tidak didukung perangkat ini (Aman)"));
        }
    };

    try {
        if (scanner.getState() === 2) return; // 2 = SCANNING
    } catch(e) {}

    // [CANGGIH] Logika Pemilihan Kamera Anti-Gagal
    Html5Qrcode.getCameras().then(cameras => {
        let selectedCameraId = null;
        if (cameras && cameras.length > 0) {
            // Prioritas 1: Kamera Belakang Utama (HP)
            const backCameras = cameras.filter(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('rear') || c.label.toLowerCase().includes('belakang'));
            if (backCameras.length > 0) {
                const mainCamera = backCameras.find(c => {
                    const label = c.label.toLowerCase();
                    const isUltraWide = label.includes('ultra') || (label.includes('wide') && (label.includes('0.5') || label.includes('0.6')));
                    const isSpecial = label.includes('tele') || label.includes('macro') || label.includes('depth') || label.includes('virtual');
                    return (label.includes('0') || label.includes('main') || label.includes('primary')) && !isUltraWide && !isSpecial;
                });
                selectedCameraId = mainCamera ? mainCamera.id : (backCameras.find(c => !c.label.toLowerCase().includes('ultra'))?.id || backCameras[0].id);
            } else {
                // Prioritas 2: Kamera Apapun (Laptop/Tablet tanpa kamera belakang)
                selectedCameraId = cameras[0].id;
            }
        }

        // Strategi Start: Coba ID spesifik -> Gagal? -> Coba Environment -> Gagal? -> Coba User
        const constraints = selectedCameraId ? { deviceId: { exact: selectedCameraId } } : { facingMode: "environment" };

        scanner.start(constraints, config, (decodedText) => {
            const now = Date.now();
            // [RESPONSIF] Jeda 2 detik hanya untuk produk yang SAMA persis
            if (decodedText === lastScanCode && (now - lastScanTime < 2000)) return;
            lastScanCode = decodedText;
            lastScanTime = now;
            handleScanKasir(decodedText);
            if(navigator.vibrate) navigator.vibrate(70);
            tutupModalScanner();
        })
        .then(onCameraReady)
        .catch(err => {
            console.warn("Gagal start kamera utama, mencoba mode kompatibilitas...", err);
            // Fallback 1: Mode Environment Umum
            scanner.start({ facingMode: "environment" }, config, (decodedText) => handleScanKasir(decodedText))
            .then(onCameraReady)
            .catch(e => {
                // Fallback 2: Mode User (Kamera Depan/Webcam Laptop)
                console.warn("Environment gagal, mencoba mode user...", e);
                scanner.start({ facingMode: "user" }, config, (decodedText) => handleScanKasir(decodedText))
                .then(onCameraReady)
                .catch(errFinal => {
                    showToast("Gagal akses kamera di perangkat ini.", "error");
                    tutupModalScanner();
                });
            });
        });
    }).catch(err => {
        console.error("Gagal mendapatkan daftar kamera", err);
        // Fallback Terakhir: Langsung start tanpa cek list kamera
        scanner.start({ facingMode: "environment" }, config, (decodedText) => handleScanKasir(decodedText))
        .then(onCameraReady)
        .catch(() => { showToast("Gagal akses kamera", "error"); tutupModalScanner(); });
    });
}

// FLASH TOGGLE
let isFlashOn = false;
function toggleFlash() {
    const videoEl = document.querySelector('#reader video');
    if(videoEl && videoEl.srcObject) {
        const track = videoEl.srcObject.getVideoTracks()[0];
        if(track) {
            isFlashOn = !isFlashOn;
            track.applyConstraints({ advanced: [{ torch: isFlashOn }] })
            .catch(e => console.log(e));
            
            // Visual feedback button
            const btn = document.getElementById('btn-flash');
            if(isFlashOn) btn.classList.add('text-yellow-400');
            else btn.classList.remove('text-yellow-400');
        }
    }
}

// SCANNER STOK
async function bukaScannerStok() {
    // [OPTIMASI] Load Library
    try {
        await loadScript('https://unpkg.com/html5-qrcode');
    } catch(e) {
        return showToast("Gagal memuat modul kamera.", "error");
    }

    const box = document.getElementById('box-scanner-stok');
    box.classList.remove('hidden');
    
    if (!scannerStok) {
        scannerStok = new Html5Qrcode("reader-stok");
    }

    scannerStok.start({ facingMode: "environment" }, { fps: 10 }, (decodedText) => {
        document.getElementById('f-sku').value = decodedText;
        if(navigator.vibrate) navigator.vibrate(70);
        tutupScannerStok();
        document.getElementById('f-nama').focus();
    }).catch(err => {
        showToast("Gagal buka kamera stok", "error");
        box.classList.add('hidden');
    });
}

function tutupScannerStok() {
    if(scannerStok && scannerStok.isScanning) {
        scannerStok.stop().then(() => {
            document.getElementById('box-scanner-stok').classList.add('hidden');
        }).catch(err => {
            document.getElementById('box-scanner-stok').classList.add('hidden');
        });
    } else {
        document.getElementById('box-scanner-stok').classList.add('hidden');
    }
}

// NAVIGASI HALAMAN
function bukaHalaman(nama, mode = null, pushHistory = true) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('p-' + nama).classList.add('active');
    
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if(document.getElementById('nav-' + nama)) document.getElementById('nav-' + nama).classList.add('active');
    
    // Update Sidebar Active State
    document.querySelectorAll('.nav-item-desktop').forEach(b => {
        b.classList.remove('bg-teal-50', 'text-teal-600');
        if(b.id === 'desk-nav-' + nama) b.classList.add('bg-teal-50', 'text-teal-600');
    });

    // Special case for kasir sub-modes
    if(nama === 'kasir') document.getElementById('desk-nav-kasir').classList.add('bg-teal-50', 'text-teal-600');

    // [BARU] Push State ke History Browser
    if(pushHistory) {
        history.pushState({ page: nama, mode: mode }, '', `#${nama}`);
    }

    const fab = document.getElementById('fab-tambah-produk');
    if (nama === 'stok') {
        fab.classList.remove('hidden');
        stokLimit = 20; // Reset limit saat buka halaman stok
        renderKategoriFilter();
        renderStok();
    } else {
        fab.classList.add('hidden');
    }

    if (nama === 'dashboard') {
        renderDashboard();
    }

    updateBadgePending();
    if (nama === 'pelanggan') {
        renderPelanggan();
    }

    if(nama === 'laporan') renderLaporan();

    if(nama === 'kasir') {
        if(mode) {
            switchKasirMode(mode);
        }

        // Update setting pajak di UI saat masuk halaman pengaturan/kasir
        if(document.getElementById('setting-pajak')) {
            document.getElementById('setting-pajak').value = settingPajak;
        }
        // Update dropdown pelanggan
        const selectPel = document.getElementById('pilih-pelanggan');
        selectPel.innerHTML = '<option value="">Umum (Non-Member)</option>' + 
            pelanggan.map(p => `<option value="${p.id}">${p.nama}</option>`).join('');
        
        renderMenuKategori();
        renderMenuGrid();
    } else {
        stopSemuaKamera();
    }

    if(nama !== 'stok') {
        tutupScannerStok();
    }

    if(nama === 'absensi') {
        // [FIX] Panggil fungsi dari absensi.js untuk memuat model AI
        if(typeof initAbsensiSystem === 'function') {
            initAbsensiSystem();
        }
        renderRiwayatAbsensi();
    }

    if(nama === 'barcode') {
        renderListProdukBarcode();
        generateBarcode();
    }

    if(nama === 'pengeluaran') {
        renderPengeluaran();
    }

    if(nama === 'hutang') {
        renderHutang();
    }

    if(nama === 'meja') {
        renderMeja();
    }
    
    // Update Profil Toko di Pengaturan
    if(nama === 'pengaturan') {
        document.getElementById('set-nama-toko').value = profilToko.nama;
        document.getElementById('set-alamat-toko').value = profilToko.alamat;
        document.getElementById('set-nohp-toko').value = profilToko.nohp;
        document.getElementById('set-footer-struk').value = profilToko.footer;
        document.getElementById('set-info-bayar').value = profilToko.infoBayar || '';
        tutupScannerStok();
        // Load QRIS
        if(profilToko.qrisImage) {
            document.getElementById('set-qris-preview').src = profilToko.qrisImage;
            tempQrisData = profilToko.qrisImage;
        } else {
            document.getElementById('set-qris-preview').src = 'https://via.placeholder.com/100?text=QRIS';
            tempQrisData = null;
        }
        // Load Happy Hour
        document.getElementById('hh-start').value = profilToko.happyHour?.start || '';
        document.getElementById('hh-end').value = profilToko.happyHour?.end || '';
        document.getElementById('hh-percent').value = profilToko.happyHour?.percent || '';
        // Load Vouchers
        renderVouchers();
        // Load Member Levels
        document.getElementById('level-silver-pts').value = settings.memberLevels.silver.pts;
        document.getElementById('level-silver-disc').value = settings.memberLevels.silver.disc;
        document.getElementById('level-gold-pts').value = settings.memberLevels.gold.pts;
        document.getElementById('level-gold-disc').value = settings.memberLevels.gold.disc;
        document.getElementById('setting-point-multiplier').value = settings.pointMultiplier || 10000;
        document.getElementById('setting-point-value').value = settings.pointExchangeValue || 1;
        // Load Lokasi
        if(profilToko.lokasi) {
            document.getElementById('set-lokasi-coords').value = `${profilToko.lokasi.lat.toFixed(6)}, ${profilToko.lokasi.lng.toFixed(6)}`;
        }
        // Load Lite Mode
        if(document.getElementById('setting-lite-mode')) {
            document.getElementById('setting-lite-mode').checked = settings.liteMode || false;
        }
        // Update Storage Info
        updateStorageInfo();
    }
}

// [BARU] SWITCH MODE KASIR
function switchKasirMode(mode) {
    kasirMode = mode;
    const btnRetail = document.getElementById('btn-mode-retail');
    const btnResto = document.getElementById('btn-mode-resto');
    const viewRetail = document.getElementById('view-retail');
    const viewResto = document.getElementById('view-resto');

    if(mode === 'retail') {
        // Style Button
        btnRetail.className = "flex-1 py-2 text-sm font-bold rounded-lg transition-all bg-white text-teal-600 shadow-sm ring-2 ring-teal-500";
        btnResto.className = "flex-1 py-2 text-sm font-bold rounded-lg transition-all text-slate-500 hover:bg-slate-300";
        
        // View
        viewRetail.classList.remove('hidden');
        viewResto.classList.add('hidden');

        // Start Embedded Camera
        setTimeout(startKameraRetail, 300);
    } else {
        // Style Button
        btnResto.className = "flex-1 py-2 text-sm font-bold rounded-lg transition-all bg-white text-orange-600 shadow-sm ring-2 ring-orange-500";
        btnRetail.className = "flex-1 py-2 text-sm font-bold rounded-lg transition-all text-slate-500 hover:bg-slate-300";

        // View
        viewResto.classList.remove('hidden');
        viewRetail.classList.add('hidden');

        // Stop Camera
        stopSemuaKamera();
    }
}

async function startKameraRetail() {
    // [OPTIMASI] Load Library
    try {
        await loadScript('https://unpkg.com/html5-qrcode');
    } catch(e) {
        return showToast("Gagal memuat modul kamera retail.", "error");
    }

    await stopSemuaKamera();
    if (!scanner) scanner = new Html5Qrcode("reader-retail", { verbose: false });
    
    const config = { 
        fps: 30, // [OPTIMASI] Lebih responsif
        aspectRatio: undefined, // [FIX] Auto aspect ratio
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        }
    };

    Html5Qrcode.getCameras().then(cameras => {
        let selectedCameraId = null;
        if (cameras && cameras.length > 0) {
            const backCameras = cameras.filter(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('rear') || c.label.toLowerCase().includes('belakang'));
            if (backCameras.length > 0) {
                const mainCamera = backCameras.find(c => {
                    const label = c.label.toLowerCase();
                    const isUltraWide = label.includes('ultra') || (label.includes('wide') && (label.includes('0.5') || label.includes('0.6')));
                    const isSpecial = label.includes('tele') || label.includes('macro') || label.includes('depth') || label.includes('virtual');
                    return (label.includes('0') || label.includes('main') || label.includes('primary')) && !isUltraWide && !isSpecial;
                });
                selectedCameraId = mainCamera ? mainCamera.id : (backCameras.find(c => !c.label.toLowerCase().includes('ultra'))?.id || backCameras[0].id);
            } else {
                // Fallback Laptop
                selectedCameraId = cameras[0].id;
            }
        }

        // Constraints
        const constraints = selectedCameraId ? { deviceId: { exact: selectedCameraId } } : { facingMode: "environment" };

        scanner.start(constraints, config, (decodedText) => {
            const now = Date.now();
            if (decodedText === lastScanCode && (now - lastScanTime < 2000)) return;
            lastScanCode = decodedText;
            lastScanTime = now;
            handleScanKasir(decodedText);
            if(navigator.vibrate) navigator.vibrate(70);
        })
        .then(() => {
            // [FIX] Apply focus dengan aman
            const videoEl = document.querySelector('#reader-retail video');
            if(videoEl && videoEl.srcObject) {
                const track = videoEl.srcObject.getVideoTracks()[0];
                const caps = track.getCapabilities ? track.getCapabilities() : {};
                if(caps.focusMode && caps.focusMode.includes('continuous')) {
                    track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(e=>{});
                }
            }
        })
        .catch(err => {
            console.log("Kamera retail error, mencoba fallback...", err);
            // Fallback sederhana untuk retail mode
            scanner.start({ facingMode: "environment" }, config, (decodedText) => {
                handleScanKasir(decodedText);
            }).catch(e => console.log("Gagal total kamera retail", e));
        });
    }).catch(err => {
        console.error("Gagal akses kamera retail", err);
        scanner.start({ facingMode: "environment" }, config, (decodedText) => {
            const now = Date.now();
            if (decodedText === lastScanCode && (now - lastScanTime < 2000)) return;
            lastScanCode = decodedText;
            lastScanTime = now;
            handleScanKasir(decodedText);
            if(navigator.vibrate) navigator.vibrate(70);
        });
    });
}

// [CANGGIH] Setup Voice Search
function setupVoiceSearch() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
    
    const searchInput = document.getElementById('in-search');
    if (!searchInput || document.getElementById('btn-voice-search')) return;

    const btn = document.createElement('button');
    btn.id = 'btn-voice-search';
    btn.innerHTML = '🎤';
    btn.className = 'absolute right-12 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-teal-600 p-2';
    btn.title = "Cari dengan suara";
    btn.onclick = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.lang = 'id-ID';
        recognition.start();
        showToast("Katakan nama produk...", "info");
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            document.getElementById('in-search').value = transcript;
            doSearch(transcript);
        };
    };
    
    if(searchInput.parentElement) searchInput.parentElement.appendChild(btn);
}

function toggleSearch() {
    const box = document.getElementById('search-box');
    box.classList.toggle('hidden');
    if(!box.classList.contains('hidden')) {
        document.getElementById('in-search').focus();
        document.getElementById('in-search').value = '';
        doSearch('');
    }
}

// [CANGGIH] Smart Fuzzy Search
function doSearch(val) {
    const res = document.getElementById('res-search');
    if(val.length < 1) { res.innerHTML = "<p class='text-center text-gray-400 mt-8'>Mulai ketik untuk mencari produk...</p>"; return; }
    
    const lowerVal = val.toLowerCase();
    const filtered = gudang.filter(p => p.nama.toLowerCase().includes(lowerVal) || p.sku.includes(val));
    
    if(filtered.length === 0) { res.innerHTML = "<p class='text-center text-gray-400 mt-8'>Tidak ditemukan.</p>"; return; }

    res.innerHTML = filtered.map(p => `
        <div onclick="tambahKeCart('${p.sku}'); toggleSearch();" class="flex justify-between items-center cursor-pointer hover:bg-teal-50 p-3 rounded-xl border border-slate-100 transition-colors">
            <div>
                <b class="text-slate-800">${escapeHtml(p.nama)}</b><br>
                <small class="text-gray-500">${escapeHtml(p.sku)} ${p.kategori ? '• ' + escapeHtml(p.kategori) : ''}</small>
            </div>
            <div class="text-teal-600 font-bold">Rp ${parseInt(p.harga).toLocaleString()}</div>
        </div>
    `).join('');
}

// --- MODAL PRODUK ---
function openModalTambahProduk(skuToEdit = null) {
    const modal = document.getElementById('modal-tambah-produk');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Reset form
    document.getElementById('f-sku').value = '';
    document.getElementById('f-nama').value = '';
    document.getElementById('f-harga').value = '';
    document.getElementById('f-modal').value = ''; // Reset modal
    document.getElementById('f-kategori').value = '';
    document.getElementById('f-stok').value = '';
    document.getElementById('f-expired').value = ''; // [BARU] Reset expired
    document.getElementById('f-sku').disabled = false;
    document.getElementById('f-gambar-preview').src = 'https://via.placeholder.com/150x150.png?text=Pilih+Gambar';
    tempImageData = null;

    if (skuToEdit) {
        const produk = gudang.find(p => p.sku === skuToEdit);
        if (produk) {
            document.getElementById('f-sku').value = produk.sku;
            document.getElementById('f-nama').value = produk.nama;
            document.getElementById('f-harga').value = produk.harga;
            document.getElementById('f-modal').value = produk.modal || ''; // Load modal
            document.getElementById('f-kategori').value = produk.kategori || '';
            document.getElementById('f-stok').value = produk.stok;
            document.getElementById('f-expired').value = produk.expiredDate || ''; // [BARU] Load expired
            document.getElementById('f-sku').disabled = true; // SKU tidak bisa diubah
            if (produk.gambar) {
                document.getElementById('f-gambar-preview').src = produk.gambar;
                tempImageData = produk.gambar;
            }
        }
    }
    // Populate datalist for category autocomplete
    const kategoriList = document.getElementById('kategori-list');
    const semuaKategori = [...new Set(gudang.map(p => p.kategori).filter(Boolean))];
    kategoriList.innerHTML = semuaKategori.map(k => `<option value="${k}"></option>`).join('');

    setTimeout(() => document.getElementById(skuToEdit ? 'f-nama' : 'f-sku').focus(), 100);
}

function closeModalTambahProduk() {
    const modal = document.getElementById('modal-tambah-produk');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    tutupScannerStok();
}

// CORE LOGIC
function simpanProduk() {
    const sku = document.getElementById('f-sku').value;
    const nama = document.getElementById('f-nama').value;
    const harga = parseInt(document.getElementById('f-harga').value) || 0;
    const modal = parseInt(document.getElementById('f-modal').value) || 0;
    const kategori = document.getElementById('f-kategori').value.trim();
    const stok = parseInt(document.getElementById('f-stok').value) || 0;
    const gambar = tempImageData;
    const expiredDate = document.getElementById('f-expired').value; // [BARU] Ambil tanggal

    if(!sku || !nama) return showToast("Data SKU dan Nama wajib diisi!", "error");
    if(harga < 0 || modal < 0 || stok < 0) return showToast("Harga, Modal, dan Stok tidak boleh negatif!", "error");

    // [CANGGIH] Profit Guard: Peringatan jika harga jual < modal
    if(harga < modal) {
        if(!confirm(`⚠️ PERINGATAN PROFIT:\nHarga Jual (Rp ${harga}) lebih KECIL dari Modal (Rp ${modal}).\nAnda berpotensi rugi. Tetap simpan?`)) return;
    }

    const index = gudang.findIndex(p => p.sku === sku);
    if(index > -1) {
        const oldProduk = gudang[index];
        const selisih = stok - oldProduk.stok;
        
        // [LOGIKA BARU] Manajemen Batch Expired (FIFO)
        let batches = oldProduk.batches || [];
        if (!Array.isArray(batches)) batches = []; // Safety check
        
        if (selisih > 0) {
            // Jika stok bertambah, buat batch baru dengan expired date yang diinput
            if (expiredDate) {
                batches.push({
                    id: Date.now(),
                    expired: expiredDate,
                    qty: selisih
                });
            } else {
                // Jika tidak ada tanggal, masukkan ke batch 'tanpa tanggal' atau update batch terakhir
                batches.push({ id: Date.now(), expired: null, qty: selisih });
            }
        } else if (selisih < 0) {
            // Jika stok berkurang (koreksi manual), kurangi dari batch terlama (FIFO)
            let sisaKurang = Math.abs(selisih);
            // Sort batch berdasarkan tanggal (null di akhir)
            batches.sort((a, b) => (a.expired || '9999') > (b.expired || '9999') ? 1 : -1);
            
            batches = batches.map(b => {
                if (sisaKurang <= 0) return b;
                const ambil = Math.min(b.qty, sisaKurang);
                b.qty -= ambil;
                sisaKurang -= ambil;
                return b;
            }).filter(b => b.qty > 0); // Hapus batch kosong
        }

        logStockChange(sku, nama, selisih, 'Edit Manual');
        // Simpan expiredDate utama sebagai tanggal terdekat dari batch yang ada
        const nearestExp = batches.length > 0 ? batches.sort((a, b) => (a.expired || '9999') > (b.expired || '9999') ? 1 : -1)[0].expired : expiredDate;
        
        gudang[index] = {sku, nama, harga, modal, kategori, stok, gambar, expiredDate: nearestExp, batches};
    } else {
        // Produk Baru
        const batches = expiredDate ? [{ id: Date.now(), expired: expiredDate, qty: stok }] : [];
        gudang.push({sku, nama, harga, modal, kategori, stok, gambar, expiredDate, batches});
        logStockChange(sku, nama, stok, 'Produk Baru');
    }

    localStorage.setItem('gudang_data', JSON.stringify(gudang));
    showToast("Produk Berhasil Disimpan", "success");
    renderStok();
    closeModalTambahProduk();
}

// FUNGSI SUARA (TEXT-TO-SPEECH)
let currentUtterance = null;

function ucapkan(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'id-ID';
        currentUtterance = utterance;
        window.speechSynthesis.speak(utterance);
    }
}

document.addEventListener('click', function unlockAudio() {
    if ('speechSynthesis' in window && window.speechSynthesis.getVoices().length === 0) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
    }
    document.removeEventListener('click', unlockAudio);
}, { once: true });

// LOGIK SCAN KASIR BARU
function handleScanKasir(sku) {
    const produk = gudang.find(p => p.sku === sku);
    
    // 1. Jika Produk Ditemukan
    if (produk) {
        ucapkan(produk.nama);
        if (kasirMode === 'retail') {
            if(tambahKeCartCore(produk)) {
                renderCart();
                showToast(`${produk.nama} +1`, 'success');
                SoundFX.play('success');
            }
        } else {
            tempCart.unshift({
                ...produk,
                tempId: Date.now() + Math.random()
            });
            renderTempCart();
        }
        return;
    }

    // 2. Jika Bukan Produk, Cek Apakah Member?
    const member = pelanggan.find(p => p.id === sku || p.nohp === sku);
    if (member) {
        const selectPel = document.getElementById('pilih-pelanggan');
        if (selectPel) {
            selectPel.value = member.id;
            showToast(`Member Terdeteksi: ${member.nama}`, 'success');
            SoundFX.play('success');
            ucapkan(`Halo ${member.nama}`);
            
            // Jika modal bayar sedang terbuka, update hitungan (diskon member)
            if(!document.getElementById('modal-bayar').classList.contains('hidden')) {
                cekPoinPelanggan();
                hitungTotalBayar();
            }
        }
        return;
    }

    // 3. Jika Tidak Dikenal (Bukan Produk & Bukan Member)
    if(!produk && !member) {
        tempSku = sku;
        document.getElementById('txt-unknown-sku').innerText = sku;
        document.getElementById('modal-unknown').classList.remove('hidden');
        document.getElementById('modal-unknown').classList.add('flex');
        if(scanner) try { scanner.pause(); } catch(e){}
    }
}

function renderTempCart() {
    const area = document.getElementById('temp-scan-area');
    const list = document.getElementById('temp-list');
    
    if(tempCart.length === 0) {
        area.classList.add('hidden');
        return;
    }
    
    area.classList.remove('hidden');
    list.innerHTML = tempCart.map((item, i) => `
        <div class="flex justify-between items-center bg-white p-3 rounded-xl border border-teal-100 temp-item shadow-sm">
            <div class="flex-1 min-w-0 pr-2">
                <div class="font-bold text-sm text-teal-900 truncate">${escapeHtml(item.nama)}</div>
                <div class="text-[10px] text-gray-400">${escapeHtml(item.sku)}</div>
            </div>
            <div class="flex items-center gap-3">
                <span class="text-xs font-bold text-teal-600">Rp ${parseInt(item.harga).toLocaleString()}</span>
                <button onclick="hapusTemp(${i})" class="w-8 h-8 bg-red-50 text-red-500 rounded-full flex items-center justify-center font-bold text-xs hover:bg-red-100">✕</button>
            </div>
        </div>
    `).join('');
}

function hapusTemp(index) {
    tempCart.splice(index, 1);
    renderTempCart();
}

function batalTempSemua() {
    tempCart = [];
    renderTempCart();
}

function masukKeranjang() {
    tempCart.forEach(item => {
        tambahKeCartCore(item);
    });
    tempCart = [];
    renderTempCart();
    renderCart();
    SoundFX.play('success');
    if(navigator.vibrate) navigator.vibrate([50, 50, 50]);
}

function tambahKeCartCore(produk) {
    const index = cart.findIndex(c => c.sku === produk.sku);
    const produkGudang = gudang.find(g => g.sku === produk.sku);
    
    if (!produkGudang) {
        showToast("Produk tidak valid/dihapus", "error");
        return false;
    }

    if(index > -1) {
        const item = cart[index];
        // Cek stok gudang dengan aman (jika produk dihapus saat di keranjang)
        const maxStok = produkGudang.stok;
        if(item.qty < maxStok) {
            item.qty++;
            cart.splice(index, 1);
            cart.unshift(item);
            return true;
        } else {
            showToast(`Stok ${item.nama} habis (Sisa: ${maxStok})`, 'error');
            return false;
        }
    } else {
        if (produkGudang.stok > 0) {
            // [FIX] Eksplisit simpan modal saat masuk keranjang untuk akurasi laporan laba rugi
            cart.unshift({
                ...produk, 
                harga: parseInt(produk.harga), 
                modal: parseInt(produk.modal) || 0, 
                qty: 1, 
                diskon: 0 
            });
            return true;
        } else {
            showToast(`Stok ${produk.nama} habis!`, 'error');
            return false;
        }
    }
}

// MODAL UNKNOWN
function tutupModalUnknown() {
    document.getElementById('modal-unknown').classList.add('hidden');
    document.getElementById('modal-unknown').classList.remove('flex');
    if(scanner) try { scanner.resume(); } catch(e){}
}

function redirectKeStok() {
    tutupModalUnknown();
    bukaHalaman('stok');
    openModalTambahProduk();
    document.getElementById('f-sku').value = tempSku;
    document.getElementById('f-nama').focus();
}

// FUNGSI LAMA (Disesuaikan untuk Search Manual)
function tambahKeCart(sku) {
    const produk = gudang.find(p => p.sku === sku);
    if(!produk) return showToast("Produk tidak ditemukan", "error");
    if(tambahKeCartCore(produk)) {
        renderCart();
        showToast(`${produk.nama} ditambahkan`, 'success');
        SoundFX.play('success');
        playBeep();
    }
}

function renderCart() {
    const list = document.getElementById('cart-list');
    const totalEl = document.getElementById('total-harga');
    localStorage.setItem('current_cart', JSON.stringify(cart)); // [BARU] Simpan cart setiap render

    if(cart.length === 0) {
        list.innerHTML = `
            <div class="text-center py-10 text-gray-400">
                <svg class="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                <h3 class="mt-2 text-sm font-medium text-gray-500">Keranjang Kosong</h3>
                <p class="mt-1 text-sm text-gray-400">Scan produk atau cari untuk memulai transaksi.</p>
            </div>`;
    } else {
        list.innerHTML = cart.map((item, i) => {
            const hargaSetelahDiskon = item.harga - (item.diskon || 0);
            return `
                <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100 shadow-sm transition-all">
                    <div onclick="openModalEditItem(${i})" class="cursor-pointer flex-1 min-w-0 pr-2">
                        <div class="font-bold text-gray-800 truncate">${escapeHtml(item.nama)}</div>
                        <div class="text-xs text-teal-600 font-bold mt-1">Rp ${hargaSetelahDiskon.toLocaleString()} ${item.diskon > 0 ? `<span class="text-red-400 line-through ml-1 text-[10px]">${item.harga.toLocaleString()}</span>` : ''}</div>
                    </div>
                    <div class="flex items-center gap-3">
                        <button onclick="updateQty(${i}, -1)" class="w-7 h-7 bg-white rounded-full shadow-sm text-slate-600 font-bold border border-slate-200 hover:bg-slate-100 flex items-center justify-center">-</button>
                        <span class="font-bold text-gray-800 w-6 text-center">${item.qty}</span>
                        <button onclick="updateQty(${i}, 1)" class="w-7 h-7 bg-teal-600 text-white rounded-full shadow-md font-bold hover:bg-teal-700 flex items-center justify-center">+</button>
                        <button onclick="hapusItemCart(${i})" class="text-red-400 hover:text-red-600 ml-1"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    // Hitung total sementara untuk display di keranjang (belum termasuk pajak global)
    const subtotal = cart.reduce((sum, item) => sum + ((item.harga - (item.diskon || 0)) * item.qty), 0);
    
    // Cek Happy Hour untuk display
    const isHappyHour = checkHappyHour();
    if(isHappyHour) {
        totalEl.innerHTML = `<span class="text-xs text-purple-500 block">Happy Hour!</span>Rp ${subtotal.toLocaleString()}`;
    } else {
        totalEl.innerText = `Rp ${subtotal.toLocaleString()}`;
    }
}

function updateQty(i, n) {
    const item = cart[i];
    const newQty = item.qty + n;

    SoundFX.play('click');
    if (newQty > 0) {
        const produkGudang = gudang.find(g => g.sku === item.sku);
        // Jika produk hilang dari gudang, gunakan qty saat ini sebagai batas
        const maxStok = produkGudang ? produkGudang.stok : item.qty;
        
        if (newQty <= maxStok) {
            item.qty = newQty;
        } else {
            showToast(`Stok ${item.nama} hanya tersisa ${maxStok}`, 'error');
        }
    } else {
        cart.splice(i, 1);
    }
    renderCart();
}

// [BARU] Fungsi Hapus Item Langsung
function hapusItemCart(i) {
    cart.splice(i, 1);
    SoundFX.play('error'); // Sound hapus
    renderCart();
}

// --- HOLD / PENDING CART ---
function holdCart() {
    if(cart.length === 0) return showToast("Keranjang kosong!", "error");
    
    const note = prompt("Masukkan nama/catatan untuk pesanan ini:", "Pelanggan " + (pendingCarts.length + 1));
    if(note === null) return; // Cancel

    pendingCarts.push({
        id: Date.now(),
        note: note || "Tanpa Nama",
        date: new Date().toISOString(),
        items: [...cart]
    });
    
    localStorage.setItem('pending_carts', JSON.stringify(pendingCarts));
    cart = [];
    renderCart();
    updateBadgePending();
    showToast("Pesanan disimpan!", "success");
}

function updateBadgePending() {
    const badge = document.getElementById('badge-pending');
    if(pendingCarts.length > 0) {
        badge.innerText = pendingCarts.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function bukaModalPending() {
    const list = document.getElementById('list-pending');
    const empty = document.getElementById('empty-pending');
    
    if(pendingCarts.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
    } else {
        empty.classList.add('hidden');
        list.innerHTML = pendingCarts.map((p, i) => `
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 flex justify-between items-center">
                <div onclick="recallCart(${i})" class="cursor-pointer flex-1">
                    <div class="font-bold text-slate-800">${escapeHtml(p.note)}</div>
                    <div class="text-xs text-slate-500">${new Date(p.date).toLocaleTimeString('id-ID')} • ${p.items.length} Item</div>
                </div>
                <button onclick="hapusPending(${i})" class="text-red-500 p-2 hover:bg-red-50 rounded-lg">✕</button>
            </div>
        `).join('');
    }
    
    document.getElementById('modal-pending').classList.remove('hidden');
    document.getElementById('modal-pending').classList.add('flex');
}

function tutupModalPending() {
    document.getElementById('modal-pending').classList.add('hidden');
    document.getElementById('modal-pending').classList.remove('flex');
}

function recallCart(index) {
    if(cart.length > 0 && !confirm("Keranjang saat ini tidak kosong. Timpa dengan pesanan yang disimpan?")) return;
    
    cart = [...pendingCarts[index].items];
    pendingCarts.splice(index, 1);
    localStorage.setItem('pending_carts', JSON.stringify(pendingCarts));
    
    renderCart();
    updateBadgePending();
    tutupModalPending();
    showToast("Pesanan dikembalikan ke keranjang", "success");
}

function hapusPending(index) {
    if(confirm("Hapus simpanan pesanan ini?")) {
        pendingCarts.splice(index, 1);
        localStorage.setItem('pending_carts', JSON.stringify(pendingCarts));
        bukaModalPending(); // Re-render
        updateBadgePending();
    }
}

// --- EDIT ITEM KERANJANG ---
function openModalEditItem(index) {
    const item = cart[index];
    document.getElementById('edit-index').value = index;
    document.getElementById('edit-qty').value = item.qty;
    document.getElementById('edit-diskon').value = item.diskon || 0;
    
    const modal = document.getElementById('modal-edit-item');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeModalEditItem() {
    const modal = document.getElementById('modal-edit-item');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function simpanEditItem() {
    const index = parseInt(document.getElementById('edit-index').value);
    const qty = parseInt(document.getElementById('edit-qty').value);
    const diskon = parseInt(document.getElementById('edit-diskon').value) || 0;

    if(qty > 0) {
        cart[index].qty = qty;
        cart[index].diskon = diskon;
        renderCart();
        closeModalEditItem();
    } else {
        if(confirm("Hapus item ini?")) {
            cart.splice(index, 1);
            renderCart();
            closeModalEditItem();
        }
    }
}

// --- SPLIT BILL LOGIC ---
let splitSelection = []; // Array of indices from cart

function bukaModalSplitBill() {
    if(cart.length === 0) return showToast("Keranjang kosong!", "error");
    splitSelection = [];
    renderSplitList();
    document.getElementById('modal-split-bill').classList.remove('hidden');
    document.getElementById('modal-split-bill').classList.add('flex');
}

function tutupModalSplitBill() {
    document.getElementById('modal-split-bill').classList.add('hidden');
    document.getElementById('modal-split-bill').classList.remove('flex');
}

function toggleSplitItem(index) {
    if(splitSelection.includes(index)) {
        splitSelection = splitSelection.filter(i => i !== index);
    } else {
        splitSelection.push(index);
    }
    renderSplitList();
}

function renderSplitList() {
    const list = document.getElementById('list-split-bill');
    let totalSplit = 0;
    
    list.innerHTML = cart.map((item, i) => {
        const isSelected = splitSelection.includes(i);
        const sub = (item.harga - (item.diskon || 0)) * item.qty;
        if(isSelected) totalSplit += sub;
        
        return `
        <div onclick="toggleSplitItem(${i})" class="flex justify-between items-center p-3 rounded-xl border cursor-pointer transition ${isSelected ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-500' : 'bg-white border-slate-200'}">
            <div class="flex-1 min-w-0 pr-2">
                <div class="font-bold text-sm text-slate-800 truncate">${escapeHtml(item.nama)}</div>
                <div class="text-xs text-slate-500">${item.qty} x ${item.harga.toLocaleString()}</div>
            </div>
            <div class="font-bold text-teal-600">Rp ${sub.toLocaleString()}</div>
        </div>`;
    }).join('');
    
    document.getElementById('total-split').innerText = `Rp ${totalSplit.toLocaleString()}`;
}

function prosesSplitBill() {
    if(splitSelection.length === 0) return showToast("Pilih item dulu!", "error");
    
    // Buat cart sementara berisi item yang dipilih
    const originalCart = [...cart];
    const bayar = [];
    const sisa = [];

    originalCart.forEach((item, i) => {
        if(splitSelection.includes(i)) bayar.push(item);
        else sisa.push(item);
    });
    
    cart = bayar;
    remainingCartItems = sisa; // Simpan sisa item untuk dikembalikan nanti
    
    tutupModalSplitBill();
    bayarSekarang(); // Proses bayar dengan cart yang sudah difilter
}

// --- FUNGSI KATEGORI ---
function getKategoriList() {
    // Mengambil semua kategori unik, memfilternya, dan mengurutkannya
    const kategoriUnik = [...new Set(gudang.map(p => p.kategori).filter(Boolean))].sort();
    return ['semua', ...kategoriUnik];
}

function renderKategoriFilter() {
    const filterEl = document.getElementById('kategori-filter');
    const currentVal = filterEl.value;
    const kategori = getKategoriList();
    filterEl.innerHTML = kategori.map(k => `<option value="${k}" ${k === currentVal ? 'selected' : ''}>${k.charAt(0).toUpperCase() + k.slice(1)}</option>`).join('');
}

function loadMoreStok() {
    stokLimit += 20;
    renderStok();
}

function renderStok() {
    const list = document.getElementById('list-stok');
    if(gudang.length === 0) {
        list.innerHTML = `
            <div class="text-center py-20 text-gray-400">
                <svg class="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                <h3 class="mt-2 text-sm font-medium text-gray-500">Belum Ada Produk</h3>
                <p class="mt-1 text-sm text-gray-400">Klik tombol '+' untuk menambahkan produk pertama Anda.</p>
            </div>`;
        return;
    }

    const filterKategori = document.getElementById('kategori-filter').value;
    const produkToShow = (filterKategori === 'semua') 
        ? gudang 
        : gudang.filter(p => p.kategori === filterKategori);

    // [FIX] Sort dulu baru Slice, agar urutan abjad konsisten saat load more
    const renderedItems = produkToShow.sort((a, b) => a.nama.toLowerCase().localeCompare(b.nama.toLowerCase())).slice(0, stokLimit).map(p => `
        <div class="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex justify-between items-center cursor-pointer hover:shadow-md transition-shadow" onclick="openModalTambahProduk('${p.sku}')">
            <img src="${p.gambar || 'https://via.placeholder.com/80x80.png?text=No+Image'}" loading="lazy" class="w-16 h-16 object-cover rounded-lg mr-4 bg-slate-100">
            <div class="flex-1 cursor-pointer" onclick="openModalTambahProduk('${p.sku}')">
                <div class="font-bold text-gray-800 text-base">${escapeHtml(p.nama)}</div>
                <div class="flex items-center gap-2 mt-1">
                    <div class="text-xs text-gray-400 font-mono">${escapeHtml(p.sku)}</div>
                    <div class="text-xs font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded">${formatRupiah(p.harga)}</div>
                </div>
                ${p.kategori ? `<div class="mt-1 text-xs text-gray-500 inline-block">${escapeHtml(p.kategori)}</div>` : ''}
            </div>
            <div class="flex flex-col items-end gap-2 ml-4">
                <span class="px-3 py-1 rounded-full text-xs font-bold ${p.stok <= 0 ? 'bg-gray-200 text-gray-600' : (p.stok < 5 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600')}">
                    ${p.stok <= 0 ? 'Habis' : 'Stok: ' + p.stok}
                </span>
                <button onclick="cetakLabelRak('${p.sku}'); event.stopPropagation();" class="text-xs text-indigo-500 font-bold bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition mb-1">Label</button>
                <button onclick="butuhAksesAdmin(() => hapusProduk(event, '${p.sku}'))" class="text-xs text-red-400 font-bold bg-red-50 px-3 py-1.5 rounded-lg hover:bg-red-100 transition">Hapus</button>
            </div>
        </div>
    `).join('');

    // Tambahkan tombol Load More jika masih ada sisa produk
    if (produkToShow.length > stokLimit) {
        list.innerHTML = renderedItems + `<button onclick="loadMoreStok()" class="w-full py-3 bg-slate-100 text-slate-500 font-bold rounded-xl mt-2 hover:bg-slate-200">Muat Lebih Banyak (${produkToShow.length - stokLimit} lagi)</button>`;
    } else {
        list.innerHTML = renderedItems;
    }
}

// [BARU] Middleware Keamanan: Cek Akses Admin/Owner
function butuhAksesAdmin(callback) {
    if (currentUser && currentUser.role === 'admin') {
        callback();
    } else {
        const pin = prompt("🔒 Akses Terbatas\nMasukkan PIN Owner/Admin untuk melanjutkan:");
        const admin = users.find(u => u.role === 'admin' && u.pin === pin);
        if (admin) {
            callback();
        } else {
            showToast("Akses Ditolak! PIN Salah.", "error");
            SoundFX.play('error');
        }
    }
}

function hapusProduk(event, sku) {
    event.stopPropagation(); // Mencegah modal edit terbuka
    if(confirm('Yakin hapus produk ini? Aksi ini tidak bisa dibatalkan.')) {
        gudang = gudang.filter(p => p.sku !== sku);
        
        // [FIX] Hapus juga dari keranjang agar tidak error
        cart = cart.filter(c => c.sku !== sku);
        tempCart = tempCart.filter(c => c.sku !== sku);
        
        // [BARU] Bersihkan juga dari Pending Carts (Simpanan)
        pendingCarts.forEach(pc => {
            pc.items = pc.items.filter(i => i.sku !== sku);
        });
        // Hapus pending cart jika kosong setelah dibersihkan
        pendingCarts = pendingCarts.filter(pc => pc.items.length > 0);
        localStorage.setItem('pending_carts', JSON.stringify(pendingCarts));
        updateBadgePending();
        
        localStorage.setItem('gudang_data', JSON.stringify(gudang));
        renderStok();
        showToast("Produk berhasil dihapus", "success");
    }
}

function cetakLabelRak(sku) {
    const p = gudang.find(x => x.sku === sku);
    if(!p) return;
    
    let html = `
    <html><head><title>Label ${p.nama}</title>
    <style>body{font-family:sans-serif;width:6cm;margin:0;padding:10px;border:1px solid #ccc;text-align:center}.nama{font-size:14px;font-weight:bold;margin-bottom:5px}.harga{font-size:24px;font-weight:bold;color:#000;margin:5px 0}.sku{font-size:10px;color:#555}svg{width:100%;height:50px}</style>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
    </head><body onload="JsBarcode('#bc', '${p.sku}', {format:'CODE128', height:40, displayValue:false}); setTimeout(()=>window.print(), 500);">
        <div class="nama">${p.nama}</div>
        <div class="harga">${formatRupiah(p.harga)}</div>
        <svg id="bc"></svg>
        <div class="sku">${p.sku}</div>
    </body></html>`;
    
    const win = window.open('', '', 'width=300,height=200');
    win.document.write(html);
    win.document.close();
}

// --- STOCK LOGGING ---
function logStockChange(sku, nama, change, reason) {
    if(change === 0) return;
    stockLog.unshift({
        date: new Date().toISOString(),
        sku, nama, change, reason
    });
    // Keep log size manageable (e.g., last 500 entries)
    if(stockLog.length > 500) stockLog.pop();
    localStorage.setItem('stock_log', JSON.stringify(stockLog));
}
function bukaModalRiwayatStok() {
    const list = document.getElementById('list-riwayat-stok');
    const empty = document.getElementById('empty-riwayat-stok');
    
    if(stockLog.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
    } else {
        empty.classList.add('hidden');
        list.innerHTML = stockLog.map(log => `
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 text-sm">
                <div class="flex justify-between font-bold text-slate-700">
                    <span>${escapeHtml(log.nama)}</span>
                    <span class="${log.change > 0 ? 'text-emerald-600' : 'text-red-500'}">${log.change > 0 ? '+' : ''}${log.change}</span>
                </div>
                <div class="flex justify-between text-xs text-slate-400 mt-1">
                    <span>${new Date(log.date).toLocaleString('id-ID')}</span>
                    <span>${log.reason}</span>
                </div>
            </div>
        `).join('');
    }
    document.getElementById('modal-riwayat-stok').classList.remove('hidden');
    document.getElementById('modal-riwayat-stok').classList.add('flex');
}

function tutupModalRiwayatStok() {
    document.getElementById('modal-riwayat-stok').classList.add('hidden');
    document.getElementById('modal-riwayat-stok').classList.remove('flex');
}

// [BARU] FITUR STOK OPNAME
function bukaModalStokOpname() {
    const list = document.getElementById('list-opname-items');
    // Render semua produk untuk opname
    // Tips: Jika produk ribuan, sebaiknya tambahkan filter kategori di modal ini. Untuk sekarang kita render semua.
    list.innerHTML = gudang.sort((a,b) => a.nama.localeCompare(b.nama)).map((p, i) => `
        <div class="flex items-center justify-between p-3 border-b border-slate-100 text-sm hover:bg-slate-50">
            <div class="flex-1 pr-2">
                <div class="font-bold text-slate-700">${escapeHtml(p.nama)}</div>
                <div class="text-xs text-slate-400 font-mono">${p.sku}</div>
            </div>
            <div class="flex items-center gap-3">
                <div class="text-center w-16 bg-slate-100 rounded p-1">
                    <div class="text-[9px] text-slate-400 uppercase">Sistem</div>
                    <div class="font-bold text-slate-600">${p.stok}</div>
                </div>
                <div class="w-24">
                    <input type="number" data-sku="${p.sku}" data-system="${p.stok}" class="input-opname w-full p-2 border border-slate-300 rounded-lg text-center font-bold outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500" placeholder="${p.stok}">
                </div>
            </div>
        </div>
    `).join('');
    
    document.getElementById('modal-stok-opname').classList.remove('hidden');
    document.getElementById('modal-stok-opname').classList.add('flex');
}

function tutupModalStokOpname() {
    document.getElementById('modal-stok-opname').classList.add('hidden');
    document.getElementById('modal-stok-opname').classList.remove('flex');
}

function simpanStokOpname() {
    const inputs = document.querySelectorAll('.input-opname');
    const adjustments = [];
    let changeCount = 0;

    inputs.forEach(input => {
        const sku = input.dataset.sku;
        const systemStok = parseInt(input.dataset.system);
        // Jika kosong, anggap sesuai sistem (tidak ada perubahan)
        if (input.value === '') return;
        
        const fisikStok = parseInt(input.value);
        if (fisikStok !== systemStok) {
            const diff = fisikStok - systemStok;
            const produk = gudang.find(p => p.sku === sku);
            if (produk) {
                produk.stok = fisikStok;
                logStockChange(sku, produk.nama, diff, 'Stok Opname');
                adjustments.push({ sku, nama: produk.nama, system: systemStok, fisik: fisikStok, diff });
                changeCount++;
            }
        }
    });

    if (changeCount > 0) {
        stokOpnameLog.unshift({
            id: 'OPN-' + Date.now(),
            tanggal: new Date().toISOString(),
            items: adjustments,
            petugas: currentUser ? currentUser.nama : 'Unknown'
        });
        
        localStorage.setItem('gudang_data', JSON.stringify(gudang));
        localStorage.setItem('stock_log', JSON.stringify(stockLog));
        localStorage.setItem('stok_opname_log', JSON.stringify(stokOpnameLog));
        
        showToast(`${changeCount} stok produk berhasil disesuaikan.`, "success");
        renderStok();
        tutupModalStokOpname();
    } else {
        showToast("Tidak ada perubahan stok yang dicatat.", "info");
    }
}

function bukaRiwayatOpname() {
    bukaHalaman('laporan'); // Redirect ke laporan
    // Atau bisa buat modal khusus riwayat opname jika diinginkan
    // Disini kita integrasikan ke modal laporan opname khusus
    renderLaporanStokOpname();
}

// --- MANAJEMEN PELANGGAN ---
function renderPelanggan() {
    const list = document.getElementById('list-pelanggan');
    const empty = document.getElementById('empty-pelanggan');
    
    if(pelanggan.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    
    empty.classList.add('hidden');
    list.innerHTML = pelanggan.map(p => `
        <div class="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex justify-between items-center">
            <div>
                <div class="font-bold text-gray-800">${escapeHtml(p.nama)}</div>
                <div class="text-xs text-gray-500">${escapeHtml(p.nohp)} <span class="ml-2 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-bold text-[10px]">${p.poin || 0} Poin</span></div>
                <div class="text-[10px] text-gray-400 truncate max-w-[200px]">${escapeHtml(p.alamat || '-')}</div>
                <div class="text-[10px] font-mono text-slate-400 mt-1">ID: ${p.id}</div>
            </div>
            <div class="flex gap-2">
                <button onclick="setBarcodeFromProduct('${p.id}', '${p.nama}')" class="text-indigo-500 bg-indigo-50 p-2 rounded-lg hover:bg-indigo-100" title="Barcode Member">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 17h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg>
                </button>
                <button onclick="hapusPelanggan('${p.id}')" class="text-red-500 bg-red-50 p-2 rounded-lg hover:bg-red-100">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
            </div>
        </div>
    `).join('');
}

function openModalTambahPelanggan() {
    document.getElementById('pel-nama').value = '';
    document.getElementById('pel-nohp').value = '';
    document.getElementById('pel-alamat').value = '';
    document.getElementById('modal-tambah-pelanggan').classList.remove('hidden');
    document.getElementById('modal-tambah-pelanggan').classList.add('flex');
}

function closeModalTambahPelanggan() {
    document.getElementById('modal-tambah-pelanggan').classList.add('hidden');
    document.getElementById('modal-tambah-pelanggan').classList.remove('flex');
}

function simpanPelanggan() {
    const nama = document.getElementById('pel-nama').value;
    const nohp = document.getElementById('pel-nohp').value;
    const alamat = document.getElementById('pel-alamat').value;
    
    if(!nama) return showToast("Nama pelanggan wajib diisi", "error");
    
    pelanggan.push({ id: 'PEL-' + Date.now(), nama, nohp, alamat, poin: 0 });
    localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
    showToast("Pelanggan berhasil ditambahkan", "success");
    closeModalTambahPelanggan();
    renderPelanggan();
}

function hapusPelanggan(id) {
    if(confirm("Hapus data pelanggan ini?")) {
        pelanggan = pelanggan.filter(p => p.id !== id);
        localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
        renderPelanggan();
        showToast("Pelanggan dihapus", "success");
    }
}

// --- LOGIKA PEMBAYARAN & PAJAK ---
function simpanSettingPajak(val) {
    settingPajak = parseFloat(val) || 0;
    localStorage.setItem('setting_pajak', settingPajak);
    showToast("Pengaturan pajak disimpan", "success");
}

function simpanProfilToko() {
    profilToko.nama = document.getElementById('set-nama-toko').value || 'KASIR PINTAR PRO';
    profilToko.alamat = document.getElementById('set-alamat-toko').value || '';
    profilToko.nohp = document.getElementById('set-nohp-toko').value || '';
    profilToko.footer = document.getElementById('set-footer-struk').value || '';
    profilToko.infoBayar = document.getElementById('set-info-bayar').value || '';
    profilToko.qrisImage = tempQrisData; // [BARU] Simpan QRIS
    
    localStorage.setItem('profil_toko', JSON.stringify(profilToko));
    document.getElementById('header-nama-toko').innerHTML = profilToko.nama;
    showToast("Profil toko berhasil disimpan", "success");
}

// [BARU] Simpan Lokasi Toko (Geofencing)
function simpanLokasiToko() {
    if(!navigator.geolocation) return showToast("GPS tidak didukung browser ini", "error");
    
    showToast("Mendapatkan lokasi...", "info");
    navigator.geolocation.getCurrentPosition(pos => {
        profilToko.lokasi = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
        };
        localStorage.setItem('profil_toko', JSON.stringify(profilToko));
        document.getElementById('set-lokasi-coords').value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
        showToast("Lokasi toko berhasil dikunci! Absensi sekarang dibatasi radius 50m.", "success");
    }, err => {
        showToast("Gagal akses GPS: " + err.message, "error");
    }, { enableHighAccuracy: true });
}

function simpanHappyHour() {
    profilToko.happyHour = {
        start: document.getElementById('hh-start').value,
        end: document.getElementById('hh-end').value,
        percent: parseFloat(document.getElementById('hh-percent').value) || 0
    };
    localStorage.setItem('profil_toko', JSON.stringify(profilToko));
    showToast("Setting Happy Hour disimpan", "success");
}

function simpanLevelMember() {
    settings.memberLevels = {
        silver: {
            pts: parseInt(document.getElementById('level-silver-pts').value) || 0,
            disc: parseFloat(document.getElementById('level-silver-disc').value) || 0,
        },
        gold: {
            pts: parseInt(document.getElementById('level-gold-pts').value) || 0,
            disc: parseFloat(document.getElementById('level-gold-disc').value) || 0,
        }
    };
    localStorage.setItem('app_settings', JSON.stringify(settings));
    showToast("Setting Level Member disimpan", "success");
}

function simpanPengaturanPoin() {
    const val = parseInt(document.getElementById('setting-point-multiplier').value);
    const exchange = parseInt(document.getElementById('setting-point-value').value);
    if(!val || val < 1000) return showToast("Nominal kelipatan tidak valid (min 1000)", "error");
    
    settings.pointMultiplier = val;
    settings.pointExchangeValue = exchange || 1;
    localStorage.setItem('app_settings', JSON.stringify(settings));
    showToast("Pengaturan Poin disimpan", "success");
}

function tambahVoucher() {
    const code = document.getElementById('voucher-code').value.toUpperCase();
    const value = parseInt(document.getElementById('voucher-value').value);

    if(!code || !value) return showToast("Kode dan Nominal wajib diisi!", "error");
    if(vouchers.find(v => v.code === code)) return showToast("Kode voucher sudah ada!", "error");

    vouchers.push({ code, value, used: false });
    localStorage.setItem('vouchers_data', JSON.stringify(vouchers));
    renderVouchers();
    document.getElementById('voucher-code').value = '';
    document.getElementById('voucher-value').value = '';
}

function hapusVoucher(code) {
    vouchers = vouchers.filter(v => v.code !== code);
    localStorage.setItem('vouchers_data', JSON.stringify(vouchers));
    renderVouchers();
}

function renderVouchers() {
    const list = document.getElementById('list-vouchers');
    list.innerHTML = vouchers.map(v => `<div class="flex justify-between items-center bg-white p-2 rounded-lg border text-sm"><span class="font-mono font-bold text-sky-700">${v.code}</span><span>Rp ${v.value.toLocaleString()}</span><button onclick="hapusVoucher('${v.code}')" class="text-red-500">✕</button></div>`).join('');
}

function bayarSekarang() {
    if(cart.length === 0) return showToast("Keranjang Kosong!", "error");
    if(!activeShift) {
        showToast("Shift belum dibuka! Silakan buka shift dulu.", "error");
        return checkShiftStatus();
    }
    
    setMetodeBayar('tunai'); // Default
    document.getElementById('input-diskon-global').value = '';
    document.getElementById('input-voucher').value = '';
    cekPoinPelanggan(); // Cek jika pelanggan sudah dipilih sebelumnya
    hitungTotalBayar();
    
    const inputUang = document.getElementById('input-uang');
    inputUang.value = '';
    document.getElementById('txt-kembalian').innerText = 'Rp 0';
    document.getElementById('text-info-bayar').innerText = profilToko.infoBayar || "Belum ada info pembayaran.";
    
    document.getElementById('modal-bayar').classList.remove('hidden');
    document.getElementById('modal-bayar').classList.add('flex');
    setTimeout(() => {
        inputUang.focus();
    }, 100);
}

function setMetodeBayar(metode) {
    metodePembayaran = metode;
    const btnTunai = document.getElementById('btn-bayar-tunai');
    const btnNon = document.getElementById('btn-bayar-nontunai');
    const btnHutang = document.getElementById('btn-bayar-hutang');
    const boxInfo = document.getElementById('box-info-bayar');
    const inputUang = document.getElementById('input-uang');

    // Reset styles
    const inactiveClass = "flex-1 py-2 text-sm font-bold rounded-lg text-gray-500 hover:text-gray-700 transition-all";
    btnTunai.className = inactiveClass;
    btnNon.className = inactiveClass;
    btnHutang.className = inactiveClass;

    if(metode === 'tunai') {
        btnTunai.className = "flex-1 py-2 text-sm font-bold rounded-lg shadow-sm bg-white text-teal-600 transition-all ring-2 ring-teal-500";
        boxInfo.classList.add('hidden');
        inputUang.value = '';
        inputUang.disabled = false;
        inputUang.focus();
    } else if (metode === 'nontunai') {
        btnNon.className = "flex-1 py-2 text-sm font-bold rounded-lg shadow-sm bg-white text-blue-600 transition-all ring-2 ring-blue-500";
        boxInfo.classList.remove('hidden');
        
        // [BARU] Tampilkan QRIS jika ada
        const imgQris = document.getElementById('img-qris-display');
        if(profilToko.qrisImage) {
            imgQris.src = profilToko.qrisImage;
            imgQris.classList.remove('hidden');
        } else {
            imgQris.classList.add('hidden');
        }

        // Auto fill total for non-tunai
        inputUang.value = hitungTotalBayar();
        inputUang.disabled = true;
    } else if (metode === 'hutang') {
        btnHutang.className = "flex-1 py-2 text-sm font-bold rounded-lg shadow-sm bg-white text-amber-600 transition-all ring-2 ring-amber-500";
        boxInfo.classList.add('hidden');
        inputUang.value = 0;
        inputUang.disabled = true;
        
        // Cek apakah pelanggan dipilih
        const pelId = document.getElementById('pilih-pelanggan').value;
        if(!pelId) {
            showToast("Wajib pilih pelanggan untuk Hutang!", "error");
        }
    }
    hitungKembalian();
}

function checkHappyHour() {
    if(!profilToko.happyHour || !profilToko.happyHour.start || !profilToko.happyHour.end || profilToko.happyHour.percent <= 0) return false;
    
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    
    const [startH, startM] = profilToko.happyHour.start.split(':').map(Number);
    const start = startH * 60 + startM;
    
    const [endH, endM] = profilToko.happyHour.end.split(':').map(Number);
    const end = endH * 60 + endM;
    
    return current >= start && current <= end;
}

// [BARU] Fungsi Cek Poin Pelanggan di Modal Bayar
function cekPoinPelanggan() {
    const pelId = document.getElementById('pilih-pelanggan').value;
    const box = document.getElementById('box-tukar-poin');
    const lblPoin = document.getElementById('lbl-poin-member');
    const lblNilai = document.getElementById('lbl-nilai-tukar');
    const input = document.getElementById('input-tukar-poin');

    if(!pelId) {
        box.classList.add('hidden');
        input.value = '';
        return;
    }

    const p = pelanggan.find(x => x.id === pelId);
    if(p) {
        box.classList.remove('hidden');
        lblPoin.innerText = p.poin || 0;
        const val = settings.pointExchangeValue || 1;
        lblNilai.innerText = `x Rp ${val}`;
        input.value = ''; // Reset input saat ganti pelanggan
    }
}

function gunakanSemuaPoin() {
    const pelId = document.getElementById('pilih-pelanggan').value;
    const p = pelanggan.find(x => x.id === pelId);
    if(p) {
        document.getElementById('input-tukar-poin').value = p.poin || 0;
        hitungTotalBayar();
    }
}

function hitungTotalBayar() {
    // 1. Hitung Subtotal (Harga Item - Diskon Item) * Qty
    const subtotal = cart.reduce((sum, item) => sum + ((item.harga - (item.diskon || 0)) * item.qty), 0);
    
    // 2. Ambil Diskon Global
    // [BARU] Support Diskon Persen (misal: "10%")
    const diskonInput = document.getElementById('input-diskon-global').value;
    let diskonGlobal = 0;
    if(diskonInput.includes('%')) {
        const persentase = parseFloat(diskonInput.replace('%', '')) || 0;
        diskonGlobal = subtotal * (persentase / 100);
    } else {
        diskonGlobal = parseInt(diskonInput) || 0;
    }
    
    // [BARU] Cek Voucher
    const voucherCode = document.getElementById('input-voucher').value.toUpperCase();
    const voucher = vouchers.find(v => v.code === voucherCode && !v.used);
    if(voucherCode && voucher) {
        diskonGlobal += voucher.value;
        showToast(`Voucher ${voucherCode} diterapkan!`, 'success');
    } else if (voucherCode) {
        showToast(`Voucher tidak valid atau sudah digunakan.`, 'error');
    }

    // [BARU] Cek Happy Hour Auto Discount
    if(checkHappyHour()) {
        const hhDisc = subtotal * (profilToko.happyHour.percent / 100);
        diskonGlobal += hhDisc;
    }

    // [BARU] Cek Member Level Discount
    const pelId = document.getElementById('pilih-pelanggan').value;
    const pelData = pelanggan.find(p => p.id === pelId);
    if(pelData) {
        const { silver, gold } = settings.memberLevels;
        if(pelData.poin >= gold.pts && gold.disc > 0) {
            diskonGlobal += subtotal * (gold.disc / 100);
        } else if (pelData.poin >= silver.pts && silver.disc > 0) {
            diskonGlobal += subtotal * (silver.disc / 100);
        }
    }

    // [BARU] Hitung Tukar Poin
    const inputPoin = parseInt(document.getElementById('input-tukar-poin').value) || 0;
    let diskonPoin = 0;
    if (pelData && inputPoin > 0) {
        if (inputPoin > (pelData.poin || 0)) {
            // Jika input melebihi saldo, set ke max saldo
            document.getElementById('input-tukar-poin').value = pelData.poin || 0;
            diskonPoin = (pelData.poin || 0) * (settings.pointExchangeValue || 1);
        } else {
            diskonPoin = inputPoin * (settings.pointExchangeValue || 1);
        }
    }
    diskonGlobal += diskonPoin;

    // 3. Hitung Pajak (dari Subtotal - Diskon Global)
    const taxableAmount = Math.max(0, subtotal - diskonGlobal);
    const pajakNominal = Math.round(taxableAmount * (settingPajak / 100));
    
    // 4. Total Akhir
    const totalAkhir = taxableAmount + pajakNominal;

    // Render ke UI
    document.getElementById('bayar-subtotal').innerText = `Rp ${subtotal.toLocaleString()}`;
    document.getElementById('bayar-pajak').innerText = `Rp ${pajakNominal.toLocaleString()} (${settingPajak}%)`;
    document.getElementById('bayar-total').innerText = `Rp ${totalAkhir.toLocaleString()}`;
    
    return totalAkhir;
}

function tutupModalBayar() {
    document.getElementById('modal-bayar').classList.add('hidden');
    document.getElementById('modal-bayar').classList.remove('flex');
}

function hitungKembalian() {
    const total = hitungTotalBayar();
    const uang = parseInt(document.getElementById('input-uang').value) || 0;
    const kembali = uang - total;
    document.getElementById('txt-kembalian').innerText = `Rp ${kembali.toLocaleString()}`;
    document.getElementById('txt-kembalian').className = kembali >= 0 ? "text-2xl font-bold text-emerald-600" : "text-2xl font-bold text-red-600";
}

function prosesPembayaranFinal() {
    if(isProcessingPay) return; // [BARU] Cegah double submit
    isProcessingPay = true;

    const total = hitungTotalBayar();
    const uang = parseInt(document.getElementById('input-uang').value) || 0;
    
    if(metodePembayaran !== 'hutang' && uang < total) {
        isProcessingPay = false;
        return showToast("Uang kurang!", "error");
    }
    // [FIX] Kembalian untuk hutang harus 0 (karena uang masuk dianggap 0 atau DP, tapi di sini hutang full)
    const kembali = metodePembayaran === 'hutang' ? 0 : (uang - total);

    // Validasi Hutang
    const pelId = document.getElementById('pilih-pelanggan').value;
    if(metodePembayaran === 'hutang' && !pelId) {
        isProcessingPay = false;
        return showToast("Pilih pelanggan dulu!", "error");
    }

    let totalBayar = 0;
    const itemsStruk = [];

    cart.forEach(item => {
        const p = gudang.find(x => x.sku === item.sku);
        if(p) {
            p.stok -= item.qty;
            
            // [FIX] Handle Legacy Data: Pastikan batches ada
            if (!p.batches) p.batches = [];
            
            // Jika total qty di batches < stok sebelum transaksi, buat batch dummy untuk sisa stok lama
            const totalBatchQty = p.batches.reduce((sum, b) => sum + b.qty, 0);
            const stokSebelumnya = p.stok + item.qty;
            if (totalBatchQty < stokSebelumnya) { 
                const diff = stokSebelumnya - totalBatchQty;
                p.batches.push({ id: Date.now(), expired: p.expiredDate || null, qty: diff });
            }

            // [LOGIKA BARU] Kurangi Stok dari Batch (FIFO)
            if (p.batches && p.batches.length > 0) {
                let sisaButuh = item.qty;
                // Urutkan batch: yang ada tanggal expired duluan, baru yang null
                p.batches.sort((a, b) => {
                    if (!a.expired) return 1;
                    if (!b.expired) return -1;
                    return new Date(a.expired) - new Date(b.expired);
                });

                p.batches = p.batches.map(b => {
                    if (sisaButuh <= 0) return b;
                    const ambil = Math.min(b.qty, sisaButuh);
                    b.qty -= ambil;
                    sisaButuh -= ambil;
                    return b;
                }).filter(b => b.qty > 0); // Hapus batch yang sudah habis (qty 0)
                
                // Update expiredDate utama ke yang paling dekat sekarang
                if(p.batches.length > 0) p.expiredDate = p.batches[0].expired;
            }
        }
        logStockChange(item.sku, item.nama, -item.qty, 'Penjualan');
        // Simpan harga final per item di struk
        itemsStruk.push({...item});
    });

    const subtotal = cart.reduce((sum, item) => sum + ((item.harga - (item.diskon || 0)) * item.qty), 0);
    
    // Hitung ulang diskon final untuk disimpan
    const diskonInput = document.getElementById('input-diskon-global').value;
    let diskonGlobal = 0;
    if(diskonInput.includes('%')) {
        diskonGlobal = subtotal * (parseFloat(diskonInput.replace('%', '')) / 100);
    } else {
        diskonGlobal = parseInt(diskonInput) || 0;
    }
    
    // [BARU] Apply Happy Hour to Final Transaction Data
    if(checkHappyHour()) {
        const hhDisc = subtotal * (profilToko.happyHour.percent / 100);
        diskonGlobal += hhDisc;
    }

    // Ambil data pelanggan
    const pelData = pelanggan.find(p => p.id === pelId);

    // [BARU] Apply Member Level Discount to Final Transaction Data
    if(pelData) {
        const { silver, gold } = settings.memberLevels;
        if(pelData.poin >= gold.pts && gold.disc > 0) {
            diskonGlobal += subtotal * (gold.disc / 100);
        } else if (pelData.poin >= silver.pts && silver.disc > 0) {
            diskonGlobal += subtotal * (silver.disc / 100);
        }
    }

    // [BARU] Apply Voucher to Final Transaction Data
    const voucherCode = document.getElementById('input-voucher').value.toUpperCase();
    const voucher = vouchers.find(v => v.code === voucherCode && !v.used);
    if(voucher) {
        diskonGlobal += voucher.value;
        // Mark as used (for simplicity, we assume all vouchers are single-use)
        voucher.used = true;
    }

    // [BARU] Apply Point Redemption
    const inputPoin = parseInt(document.getElementById('input-tukar-poin').value) || 0;
    if (pelData && inputPoin > 0) {
        const nilaiTukar = inputPoin * (settings.pointExchangeValue || 1);
        diskonGlobal += nilaiTukar;
        
        // Kurangi Poin Pelanggan
        pelData.poin = (pelData.poin || 0) - inputPoin;
    }

    const pajakNominal = Math.round(Math.max(0, subtotal - diskonGlobal) * (settingPajak / 100));
    
    // Hitung Poin (Sesuai Setting)
    let poinDidapat = 0;
    if (pelData) {
        const multiplier = settings.pointMultiplier || 10000;
        poinDidapat = Math.floor(total / multiplier);
        pelData.poin = (pelData.poin || 0) + poinDidapat;
        
        // [BARU] Tambah Hutang jika metode hutang
        if(metodePembayaran === 'hutang') {
            pelData.hutang = (pelData.hutang || 0) + total;
        }
    }

    const transaksi = {
        id: 'TRX-' + Date.now(),
        tanggal: new Date().toISOString(),
        items: itemsStruk,
        subtotal: subtotal,
        diskonGlobal: diskonGlobal,
        pajak: pajakNominal,
        total: total,
        bayar: uang,
        kembali: kembali,
        pelanggan: pelData ? { nama: pelData.nama, id: pelData.id, nohp: pelData.nohp, poinEarned: poinDidapat } : null,
        poinRedeemed: (pelData && inputPoin > 0) ? inputPoin : 0, // [BARU] Simpan poin yang dipakai
        metode: metodePembayaran
    };
    riwayat.push(transaksi);
    
    localStorage.setItem('gudang_data', JSON.stringify(gudang));
    localStorage.setItem('riwayat_transaksi', JSON.stringify(riwayat));
    // Simpan update poin pelanggan
    localStorage.setItem('vouchers_data', JSON.stringify(vouchers));
    localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
    
    showToast("Pembayaran Berhasil!", "success");
    SoundFX.play('success');
    // [CANGGIH] Ucapkan Total
    ucapkan(`Total belanja ${total.toLocaleString()} rupiah. Terima kasih.`);
    
    tutupModalBayar();
    
    // [BARU] Jika dari meja, kosongkan meja
    if(activeTableId) {
        // If it was a split bill, remove paid items from the table
        if (splitSelection.length > 0) {
            const meja = mejaData.find(m => m.id === activeTableId);
            const paidSkus = cart.map(item => item.sku);
            meja.pesanan = meja.pesanan.filter(item => !paidSkus.includes(item.sku));
            if(meja.pesanan.length === 0) meja.status = 'kosong';
            showToast("Pembayaran Split Berhasil. Sisa pesanan tersimpan di meja.", "info");
        } else { // If it was a full payment, clear the table
            const mejaIndex = mejaData.findIndex(m => m.id === activeTableId);
            mejaData[mejaIndex].status = 'kosong';
            mejaData[mejaIndex].pesanan = [];
        }
        localStorage.setItem('meja_data', JSON.stringify(mejaData));
        tutupMejaAktif();
    } else {
        // Retail Logic: Restore remaining items if split bill
        if (remainingCartItems.length > 0) {
            cart = [...remainingCartItems];
            remainingCartItems = [];
            showToast("Pembayaran sebagian berhasil. Sisa item ada di keranjang.", "info");
            renderCart();
            return; // Don't clear cart below
        }
    }
    
    cart = [];
    splitSelection = []; // Reset split
    renderCart();
    renderKategoriFilter();
    renderStok();
    tampilkanStruk(transaksi);
    isProcessingPay = false; // [BARU] Reset flag
}

// STRUK & LAPORAN
function kirimStrukWA(trx) {
    let text = `*${profilToko.nama}*\n`;
    text += `${profilToko.alamat}\n\n`;
    text += `Tgl: ${new Date(trx.tanggal).toLocaleString('id-ID')}\n`;
    text += `ID: ${trx.id}\n`;
    text += `--------------------------------\n`;
    
    trx.items.forEach(item => {
        const hargaFinal = item.harga - (item.diskon || 0);
        text += `${item.nama} x${item.qty} = ${parseInt(hargaFinal * item.qty).toLocaleString()}\n`;
    });
    
    text += `--------------------------------\n`;
    text += `Subtotal: Rp ${trx.subtotal.toLocaleString()}\n`;
    if(trx.diskonGlobal > 0) text += `Diskon: -Rp ${trx.diskonGlobal.toLocaleString()}\n`;
    if(trx.pajak > 0) text += `Pajak: Rp ${trx.pajak.toLocaleString()}\n`;
    text += `Metode: ${trx.metode === 'tunai' ? 'TUNAI' : 'NON-TUNAI'}\n`;
    text += `*TOTAL: Rp ${trx.total.toLocaleString()}*\n`;
    text += `Tunai: Rp ${trx.bayar.toLocaleString()}\n`;
    text += `Kembali: Rp ${trx.kembali.toLocaleString()}\n\n`;
    text += `${profilToko.footer}`;

    const encodedText = encodeURIComponent(text);
    const nohp = trx.pelanggan && trx.pelanggan.nohp ? trx.pelanggan.nohp.replace(/^0/, '62').replace(/\D/g,'') : '';
    
    window.open(`https://wa.me/${nohp}?text=${encodedText}`, '_blank');
}

// [BARU] Fitur Batalkan Transaksi
function batalkanTransaksi(id) {
    if(!confirm("Yakin ingin membatalkan transaksi ini? Stok akan dikembalikan dan poin pelanggan ditarik.")) return;

    const trxIndex = riwayat.findIndex(t => t.id === id);
    if (trxIndex === -1) return showToast("Transaksi tidak ditemukan", "error");

    const trx = riwayat[trxIndex];

    // 1. Kembalikan Stok
    if (!trx.isDebtPayment) {
        trx.items.forEach(item => {
            const produk = gudang.find(p => p.sku === item.sku);
            if (produk) {
                produk.stok += item.qty;
                
                // [FIX] Restore Batch Logic (PENTING: Agar data batch tetap sinkron dengan total stok)
                if (!produk.batches) produk.batches = [];
                
                // Kembalikan ke batch dengan expired date yang sama (atau buat baru)
                const targetExp = produk.expiredDate || null;
                const existingBatch = produk.batches.find(b => b.expired === targetExp);
                
                if (existingBatch) {
                    existingBatch.qty += item.qty;
                } else {
                    produk.batches.push({ id: Date.now(), expired: targetExp, qty: item.qty });
                }
                
                // Sort ulang batch
                produk.batches.sort((a, b) => {
                    if (!a.expired) return 1;
                    if (!b.expired) return -1;
                    return new Date(a.expired) - new Date(b.expired);
                });

                logStockChange(item.sku, item.nama, item.qty, 'Batal Transaksi');
            }
        });
    }

    // 2. Rollback Data Pelanggan (Poin & Hutang)
    if (trx.pelanggan && trx.pelanggan.id) {
        const p = pelanggan.find(x => x.id === trx.pelanggan.id);
        if (p) {
            // A. Tarik kembali poin yang didapat dari transaksi ini
            if (trx.pelanggan.poinEarned) {
                p.poin = Math.max(0, (p.poin || 0) - trx.pelanggan.poinEarned);
            }
            // B. Kembalikan poin yang dipakai (redeemed)
            if (trx.poinRedeemed) {
                p.poin = (p.poin || 0) + trx.poinRedeemed;
            }
            // C. Rollback Hutang
            if (trx.isDebtPayment) {
                // Jika ini transaksi bayar hutang yang dibatalkan, hutang kembali MUNCUL
                p.hutang = (p.hutang || 0) + trx.total;
            } else if (trx.metode === 'hutang') {
                // Jika ini transaksi belanja hutang yang dibatalkan, hutang DIHAPUS
                p.hutang = Math.max(0, (p.hutang || 0) - trx.total);
            }
        }
    }

    // 3. Hapus Transaksi & Simpan
    riwayat.splice(trxIndex, 1);
    localStorage.setItem('gudang_data', JSON.stringify(gudang));
    localStorage.setItem('riwayat_transaksi', JSON.stringify(riwayat));
    localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
    localStorage.setItem('stock_log', JSON.stringify(stockLog));

    showToast("Transaksi berhasil dibatalkan", "success");
    tutupStruk();
    renderLaporan(); 
    renderDashboard();
    renderStok();
}

// [BARU] Fungsi Cetak Struk Thermal
function cetakStruk(id) {
    const trx = riwayat.find(t => t.id === id);
    if(!trx) return;
    
    let html = `
    <html><head><title>Print Struk</title><style>
        @page { size: auto; margin: 0mm; } /* [FIX] Hapus margin browser otomatis */
        body { font-family: 'Courier New', monospace; font-size: 12px; width: 58mm; margin: 0; padding: 10px 5px; color: #000; }
        .center { text-align: center; }
        .flex { display: flex; justify-content: space-between; }
        hr { border: 0; border-bottom: 1px dashed #000; margin: 5px 0; }
        .bold { font-weight: bold; }
        .small { font-size: 10px; }
    </style></head><body>
        <div class="center bold">${profilToko.nama}</div>
        <div class="center small">${profilToko.alamat}</div>
        <hr>
        <div class="small">${new Date(trx.tanggal).toLocaleString('id-ID')}</div>
        <div class="small">ID: ${trx.id}</div>
        <hr>
    `;
    
    trx.items.forEach(item => {
        html += `<div>${item.nama}</div>
        <div class="flex">
            <span>${item.qty} x ${parseInt(item.harga - (item.diskon||0)).toLocaleString()}</span>
            <span>${parseInt((item.harga - (item.diskon||0)) * item.qty).toLocaleString()}</span>
        </div>`;
    });
    
    html += `<hr>
        <div class="flex bold"><span>TOTAL</span> <span>${parseInt(trx.total).toLocaleString()}</span></div>
        <div class="flex"><span>Tunai</span> <span>${parseInt(trx.bayar).toLocaleString()}</span></div>
        <div class="flex"><span>Kembali</span> <span>${parseInt(trx.kembali).toLocaleString()}</span></div>
        <hr>
        <div class="center small">${profilToko.footer}</div>
    </body></html>`;
    
    const win = window.open('', '', 'width=300,height=500');
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 500);
}

function tampilkanStruk(trx) {
    const area = document.getElementById('receipt-area');
    const tgl = new Date(trx.tanggal).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    
    let html = `
        <h3 class="font-bold text-xl mb-1 text-gray-800 uppercase">${profilToko.nama}</h3>
        <p class="text-xs text-gray-500 mb-1">${profilToko.alamat}</p>
        <p class="text-xs text-gray-500 mb-4">${profilToko.nohp}</p>
        <p class="text-xs text-gray-500 mb-2 border-b border-dashed pb-2">${tgl}<br>ID: ${trx.id}<br>${trx.pelanggan ? 'Member: ' + trx.pelanggan.nama : 'Pelanggan: Umum'}</p>
        <div class="text-left border-t border-b border-dashed py-2 my-2 space-y-1 text-sm">
    `;
    
    trx.items.forEach(item => {
        const hargaFinal = item.harga - (item.diskon || 0);
        html += `
            <div class="flex justify-between">
                <span>${item.nama} (${item.qty}x)</span>
                <span>${(hargaFinal * item.qty).toLocaleString()}</span>
            </div>
            ${item.diskon > 0 ? `<div class="text-[10px] text-gray-400 text-right">Disc: -${item.diskon.toLocaleString()}/item</div>` : ''}
        `;
    });

    html += `
        </div>
        <div class="text-right space-y-1 mt-2 text-gray-800">
            <div class="flex justify-between text-sm text-gray-500">
                <span>Subtotal</span>
                <span>Rp ${(trx.subtotal || trx.total).toLocaleString()}</span>
            </div>
            ${trx.diskonGlobal > 0 ? `
            <div class="flex justify-between text-sm text-red-500">
                <span>Diskon</span>
                <span>-Rp ${trx.diskonGlobal.toLocaleString()}</span>
            </div>` : ''}
            ${trx.pajak > 0 ? `
            <div class="flex justify-between text-sm text-gray-500">
                <span>Pajak</span>
                <span>Rp ${trx.pajak.toLocaleString()}</span>
            </div>` : ''}
            <div class="flex justify-between text-sm text-gray-500">
                <span>Metode</span>
                <span class="uppercase font-bold">${trx.metode === 'tunai' ? 'TUNAI' : 'NON-TUNAI'}</span>
            </div>
            <div class="flex justify-between font-bold text-lg">
                <span>TOTAL</span>
                <span>Rp ${trx.total.toLocaleString()}</span>
            </div>
            <div class="flex justify-between text-sm text-gray-600">
                <span>Tunai</span>
                <span>Rp ${(trx.bayar || trx.total).toLocaleString()}</span>
            </div>
            <div class="flex justify-between text-sm text-gray-600">
                <span>Kembali</span>
                <span>Rp ${(trx.kembali || 0).toLocaleString()}</span>
            </div>
        </div>
        <p class="text-[10px] text-gray-400 mt-4">${profilToko.footer}</p>
        <div class="mt-4 pt-2 border-t border-dashed">
            <button onclick="cetakStruk('${trx.id}')" class="w-full py-2 text-xs font-bold text-slate-600 bg-slate-200 rounded-lg hover:bg-slate-300 mb-2 border border-slate-300">🖨 Cetak Struk (Thermal)</button>
            <button onclick="butuhAksesAdmin(() => batalkanTransaksi('${trx.id}'))" class="w-full py-2 text-xs font-bold text-red-500 bg-red-50 rounded-lg hover:bg-red-100 border border-red-100">⚠ Batalkan Transaksi</button>
            <button onclick="tutupStruk()" class="w-full py-2 text-xs font-bold text-slate-500 mt-2">Tutup</button>
        </div>
    `;
    
    area.innerHTML = html;
    
    // Setup tombol WA
    const btnWa = document.getElementById('btn-wa-struk');
    btnWa.onclick = () => kirimStrukWA(trx);

    document.getElementById('modal-struk').classList.remove('hidden');
    document.getElementById('modal-struk').classList.add('flex');
}

function tutupStruk() {
    document.getElementById('modal-struk').classList.add('hidden');
    document.getElementById('modal-struk').classList.remove('flex');
}

function renderLaporan() {
    const tglMulaiEl = document.getElementById('tgl-mulai');
    const tglSelesaiEl = document.getElementById('tgl-selesai');

    // Set default ke hari ini jika kosong
    if (!tglMulaiEl.value) tglMulaiEl.valueAsDate = new Date();
    if (!tglSelesaiEl.value) tglSelesaiEl.valueAsDate = new Date();

    const startDate = new Date(tglMulaiEl.value);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(tglSelesaiEl.value);
    endDate.setHours(23, 59, 59, 999);

    const filteredTrx = riwayat.filter(t => {
        const trxDate = new Date(t.tanggal);
        return trxDate >= startDate && trxDate <= endDate;
    });

    let totalOmzet = 0;
    let totalModal = 0; // HPP
    let totalProdukTerjual = 0;
    const salesByDay = {};

    filteredTrx.forEach(t => {
        // [LOGIKA BARU] Jangan hitung pembayaran hutang sebagai Omzet Penjualan (karena sudah dihitung saat transaksi hutang terjadi)
        if (!t.isDebtPayment) {
            totalOmzet += t.total;
            t.items.forEach(item => {
                totalProdukTerjual += item.qty;
                // Hitung Modal (HPP)
                // [FIX] Prioritaskan modal yang tersimpan di riwayat transaksi (snapshot)
                // Jika tidak ada (data lama), baru ambil dari gudang saat ini
                let modalPerItem = 0;
                if (item.hasOwnProperty('modal')) {
                    modalPerItem = parseInt(item.modal) || 0;
                } else {
                    const produkGudang = gudang.find(g => g.sku === item.sku);
                    modalPerItem = produkGudang ? (parseInt(produkGudang.modal) || 0) : 0;
                }
                totalModal += (modalPerItem * item.qty);
            });
            
            const day = new Date(t.tanggal).toISOString().split('T')[0];
            salesByDay[day] = (salesByDay[day] || 0) + t.total;
        }
    });

    const totalTransaksi = filteredTrx.length;
    
    // Hitung Arus Kas (Pengeluaran Operasional) di rentang tanggal
    // Hanya hitung tipe 'keluar' sebagai pengurang laba
    const filteredPengeluaran = pengeluaran.filter(p => {
        const pDate = new Date(p.tanggal);
        return pDate >= startDate && pDate <= endDate && p.jenis === 'keluar';
    }).reduce((sum, p) => sum + p.nominal, 0);

    // Hitung Laba Bersih
    const labaBersih = totalOmzet - totalModal - filteredPengeluaran;

    document.getElementById('lpr-total-omzet').innerText = `Rp ${totalOmzet.toLocaleString()}`;
    document.getElementById('lpr-total-modal').innerText = `Rp ${totalModal.toLocaleString()}`;
    document.getElementById('lpr-total-pengeluaran').innerText = `Rp ${filteredPengeluaran.toLocaleString()}`;
    document.getElementById('lpr-laba-bersih').innerText = `Rp ${labaBersih.toLocaleString()}`;
    
    // Tambahkan Tombol Analisa AI di area laporan jika belum ada
    const containerLaporan = document.getElementById('lpr-laba-bersih').parentElement.parentElement.parentElement; // Navigasi ke container utama laporan
    if(!document.getElementById('btn-analisa-ai')) {
        const btnAnalisa = document.createElement('button');
        btnAnalisa.id = 'btn-analisa-ai';
        btnAnalisa.className = "w-full mt-4 bg-indigo-600 text-white py-3 rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition flex items-center justify-center gap-2";
        btnAnalisa.innerHTML = `<span>🤖</span> Analisa Bisnis Cerdas (AI)`;
        btnAnalisa.onclick = () => analisaBisnis(filteredTrx);
        // Insert setelah grid ringkasan
        const gridRingkasan = document.getElementById('lpr-laba-bersih').parentElement.parentElement;
        gridRingkasan.parentNode.insertBefore(btnAnalisa, gridRingkasan.nextSibling);
    }

    // document.getElementById('lpr-laba-bersih').className = labaBersih >= 0 ? "text-2xl font-bold text-white" : "text-2xl font-bold text-red-200";

    const list = document.getElementById('list-riwayat');
    if (filteredTrx.length === 0) {
        list.innerHTML = `<p class='text-center text-gray-400 py-8'>Belum ada riwayat transaksi.</p>`;
    } else {
        list.innerHTML = filteredTrx.slice().reverse().map(t => `
        <div onclick='tampilkanStruk(${JSON.stringify(t)})' class="flex justify-between items-center p-3 bg-slate-50 rounded-xl border-b border-slate-100 cursor-pointer hover:bg-slate-100">
            <div>
                <div class="font-bold text-sm text-gray-800">${new Date(t.tanggal).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
                <div class="text-xs text-gray-400">${new Date(t.tanggal).toLocaleDateString('id-ID')}</div>
            </div>
            <div class="font-bold text-teal-600">Rp ${t.total.toLocaleString()}</div>
        </div>
    `).join('');
    }

    renderSalesChart(salesByDay, startDate, endDate);
}

// [BARU] Render Laporan Stok Opname
function renderLaporanStokOpname() {
    const list = document.getElementById('list-riwayat-opname');
    if(stokOpnameLog.length === 0) {
        list.innerHTML = '<p class="text-center text-gray-400 py-4">Belum ada riwayat opname.</p>';
    } else {
        list.innerHTML = stokOpnameLog.map(log => `
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-100 mb-3">
                <div class="flex justify-between items-center mb-2 border-b border-slate-200 pb-2">
                    <div>
                        <div class="font-bold text-slate-700 text-sm">${new Date(log.tanggal).toLocaleString('id-ID')}</div>
                        <div class="text-[10px] text-slate-400">Petugas: ${log.petugas}</div>
                    </div>
                    <span class="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">${log.items.length} Item Disesuaikan</span>
                </div>
                <div class="space-y-1 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                    ${log.items.map(item => `
                        <div class="flex justify-between text-xs text-slate-600">
                            <span class="truncate w-1/2">${item.nama}</span>
                            <span class="font-mono">${item.system} ➝ <b class="${item.diff > 0 ? 'text-emerald-600' : 'text-red-500'}">${item.fisik}</b> (${item.diff > 0 ? '+' : ''}${item.diff})</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }
    document.getElementById('modal-riwayat-opname').classList.remove('hidden');
    document.getElementById('modal-riwayat-opname').classList.add('flex');
}

function setLaporanHariIni() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('tgl-mulai').value = today;
    document.getElementById('tgl-selesai').value = today;
    renderLaporan();
    showToast("Filter hari ini diterapkan", "success");
}

// [BARU] MENU VISUAL UNTUK KASIR
function renderMenuKategori() {
    const tabsContainer = document.getElementById('menu-kategori-tabs');
    const kategori = getKategoriList();
    tabsContainer.innerHTML = kategori.map(k => `
        <button onclick="renderMenuGrid('${k}')" class="menu-kategori-btn flex-shrink-0 px-4 py-2 text-sm font-bold rounded-lg transition" data-kategori="${k}">
            ${k.charAt(0).toUpperCase() + k.slice(1)}
        </button>
    `).join('');
}

function renderMenuGrid(kategoriFilter = 'semua') {
    const gridContainer = document.getElementById('menu-grid');
    const produkToShow = (kategoriFilter === 'semua') 
        ? gudang 
        : gudang.filter(p => p.kategori === kategoriFilter);

    if (produkToShow.length === 0) {
        gridContainer.innerHTML = `<p class="text-center text-slate-400 col-span-full py-10">Tidak ada produk di kategori ini.</p>`;
    } else {
        gridContainer.innerHTML = produkToShow.sort((a,b) => a.nama.localeCompare(b.nama)).map(p => `
            <div onclick="tambahKeCart('${p.sku}')" class="bg-slate-50 rounded-xl p-2 flex flex-col items-center text-center cursor-pointer hover:bg-teal-50 hover:ring-2 hover:ring-teal-500 transition-all active:scale-95">
                <img src="${p.gambar || 'https://via.placeholder.com/150x150.png?text=No+Image'}" loading="lazy" class="w-full h-24 object-cover rounded-lg mb-2 bg-white">
                <p class="text-xs font-bold text-slate-700 flex-grow">${escapeHtml(p.nama)}</p>
                <p class="text-sm font-bold text-teal-600 mt-1">${formatRupiah(p.harga)}</p>
            </div>
        `).join('');
    }

    // Update active button style
    document.querySelectorAll('.menu-kategori-btn').forEach(btn => {
        if (btn.dataset.kategori === kategoriFilter) {
            btn.classList.add('bg-teal-600', 'text-white', 'shadow-md');
            btn.classList.remove('bg-slate-100', 'text-slate-600');
        } else {
            btn.classList.remove('bg-teal-600', 'text-white', 'shadow-md');
            btn.classList.add('bg-slate-100', 'text-slate-600');
        }
    });
}

function renderRiwayatAbsensi() {
    // Fungsi ini sekarang bisa dipanggil dari absensi.js juga
    absensiLog = JSON.parse(localStorage.getItem('absensi_log')) || [];
    const list = document.getElementById('riwayat-absensi');
    list.innerHTML = absensiLog.slice(0, 5).map(log => `
        <div class="flex items-center gap-3 bg-white p-3 rounded-xl border border-slate-100">
            <div class="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center text-teal-600 font-bold border-2 border-teal-500">
                ${log.user.charAt(0).toUpperCase()}
            </div>
            <div>
                <div class="font-bold text-sm text-slate-800">${log.user}</div>
                <div class="text-xs text-slate-500">${new Date(log.waktu).toLocaleString('id-ID')} • ${log.metode || 'Manual'}</div>
            </div>
        </div>
    `).join('');
}

// [BARU] LOGIKA BARCODE GENERATOR
async function generateBarcode() {
    // [OPTIMASI] Load Library Barcode
    try {
        await loadScript('https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js');
    } catch(e) {
        return showToast("Gagal memuat modul barcode.", "error");
    }

    const code = document.getElementById('bc-code').value || '12345678';
    const label = document.getElementById('bc-label').value;
    
    try {
        JsBarcode("#barcode-preview", code, {
            format: "CODE128",
            lineColor: "#000",
            width: 2,
            height: 80,
            displayValue: true,
            text: label || undefined,
            fontSize: 14,
            margin: 10
        });
    } catch(e) {
        // Ignore invalid characters input temporarily
    }
}

function renderListProdukBarcode() {
    const list = document.getElementById('list-produk-barcode');
    if(gudang.length === 0) {
        list.innerHTML = '<p class="text-center text-gray-400 text-sm">Belum ada produk.</p>';
        return;
    }
    list.innerHTML = gudang.map(p => `
        <div onclick="setBarcodeFromProduct('${p.sku}', '${p.nama}')" class="flex justify-between items-center p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-indigo-50 border border-slate-100">
            <span class="font-bold text-sm text-slate-700">${escapeHtml(p.nama)}</span>
            <span class="text-xs font-mono text-slate-500 bg-white px-2 py-1 rounded border">${p.sku}</span>
        </div>
    `).join('');
}

function setBarcodeFromProduct(sku, nama) {
    bukaHalaman('barcode'); // [BARU] Otomatis pindah ke halaman barcode
    document.getElementById('bc-code').value = sku;
    document.getElementById('bc-label').value = nama;
    generateBarcode();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function downloadBarcode() {
    const svg = document.getElementById('barcode-preview');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const data = (new XMLSerializer()).serializeToString(svg);
    const DOMURL = window.URL || window.webkitURL || window;
    
    const img = new Image();
    const svgBlob = new Blob([data], {type: 'image/svg+xml;charset=utf-8'});
    const url = DOMURL.createObjectURL(svgBlob);
    
    img.onload = function () {
        canvas.width = img.width + 20;
        canvas.height = img.height + 20;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 10, 10);
        DOMURL.revokeObjectURL(url);
        
        const imgURI = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = imgURI;
        a.download = `barcode-${document.getElementById('bc-code').value}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
    img.src = url;
}

function printBarcode() {
    const svg = document.getElementById('barcode-preview');
    const win = window.open('', '', 'height=500,width=500');
    win.document.write('<html><head><title>Print Barcode</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;">');
    win.document.write(svg.outerHTML);
    win.document.write('</body></html>');
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 500);
}

// [BARU] MANAJEMEN ARUS KAS (Pemasukan & Pengeluaran)
function tambahPengeluaran() {
    const nama = document.getElementById('out-nama').value;
    const nominal = parseInt(document.getElementById('out-nominal').value);
    const kategori = document.getElementById('out-kategori').value;
    const jenis = document.getElementById('out-jenis').value; // masuk | keluar

    if(!nama || !nominal) return showToast("Nama dan Nominal wajib diisi", "error");

    pengeluaran.unshift({
        id: Date.now(),
        tanggal: new Date().toISOString(),
        nama, nominal, kategori, jenis
    });
    localStorage.setItem('pengeluaran_data', JSON.stringify(pengeluaran));
    
    document.getElementById('out-nama').value = '';
    document.getElementById('out-nominal').value = '';
    renderPengeluaran();
    showToast("Data arus kas berhasil dicatat", "success");
}

function hapusPengeluaran(id) {
    if(!confirm("Hapus data pengeluaran ini?")) return;
    pengeluaran = pengeluaran.filter(p => p.id !== id);
    localStorage.setItem('pengeluaran_data', JSON.stringify(pengeluaran));
    renderPengeluaran();
}

function renderPengeluaran() {
    const list = document.getElementById('list-pengeluaran');
    const empty = document.getElementById('empty-pengeluaran');

    if(pengeluaran.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    list.innerHTML = pengeluaran.map(p => `
        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
            <div>
                <div class="font-bold text-slate-800">${escapeHtml(p.nama)} <span class="text-[10px] ${p.jenis === 'masuk' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'} px-1.5 py-0.5 rounded ml-1 uppercase">${p.jenis}</span></div>
                <div class="text-xs text-slate-500">${escapeHtml(p.kategori)}</div>
                <div class="text-xs text-slate-400">${new Date(p.tanggal).toLocaleDateString('id-ID')}</div>
            </div>
            <div class="flex items-center gap-3">
                <span class="font-bold ${p.jenis === 'masuk' ? 'text-emerald-600' : 'text-rose-600'}">${p.jenis === 'masuk' ? '+' : '-'}Rp ${p.nominal.toLocaleString()}</span>
                <button onclick="hapusPengeluaran(${p.id})" class="text-slate-400 hover:text-red-500">✕</button>
            </div>
        </div>
    `).join('');
}

// [BARU] MODAL SCANNER
function bukaModalScanner() {
    document.getElementById('modal-scanner').classList.remove('hidden');
    document.getElementById('modal-scanner').classList.add('flex');
    setTimeout(startKamera, 100);
}

function tutupModalScanner() {
    const modal = document.getElementById('modal-scanner');
    if (modal.classList.contains('hidden')) return;
    if (scanner && scanner.isScanning) {
        scanner.stop().catch(err => console.error("Gagal stop kamera saat tutup modal.", err));
    }
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// [BARU] Fitur Setor Laporan via WA (Pantau Jarak Jauh)
function shareLaporanWA() {
    const today = new Date().toDateString();
    const trxHariIni = riwayat.filter(t => new Date(t.tanggal).toDateString() === today);
    
    if(trxHariIni.length === 0) return showToast("Belum ada transaksi hari ini.", "info");

    const totalOmzet = trxHariIni.reduce((sum, t) => sum + t.total, 0);
    const totalTunai = trxHariIni.filter(t => t.metode === 'tunai').reduce((sum, t) => sum + t.bayar, 0); // Estimasi uang laci
    const totalNonTunai = trxHariIni.filter(t => t.metode !== 'tunai').reduce((sum, t) => sum + t.total, 0);
    
    // Hitung produk terlaris hari ini
    const productSales = {};
    trxHariIni.forEach(t => t.items.forEach(i => productSales[i.nama] = (productSales[i.nama] || 0) + i.qty));
    const topProducts = Object.entries(productSales).sort((a,b) => b[1] - a[1]).slice(0, 5).map(x => `- ${x[0]}: ${x[1]}`).join('\n');

    let text = `*LAPORAN HARIAN TOKO*\n`;
    text += `📅 ${new Date().toLocaleDateString('id-ID', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}\n`;
    text += `👤 Pelapor: ${currentUser.nama}\n\n`;
    
    text += `*RINGKASAN OMZET*\n`;
    text += `💰 Total Omzet: Rp ${totalOmzet.toLocaleString()}\n`;
    text += `📝 Jumlah Transaksi: ${trxHariIni.length}\n\n`;
    
    text += `*RINCIAN PEMBAYARAN*\n`;
    text += `💵 Tunai (Di Laci): Rp ${totalTunai.toLocaleString()}\n`;
    text += `💳 Non-Tunai: Rp ${totalNonTunai.toLocaleString()}\n\n`;

    text += `*PRODUK TERLARIS*\n${topProducts}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

// [CANGGIH] Analisa Bisnis Otomatis
function analisaBisnis(trxData) {
    if(!trxData || trxData.length === 0) return showToast("Tidak ada data untuk dianalisa", "error");

    // 1. Prediksi Penjualan
    const totalOmzet = trxData.reduce((sum, t) => sum + t.total, 0);
    const avgDaily = totalOmzet / (trxData.length > 0 ? trxData.length : 1); // Simplifikasi
    const prediction = avgDaily * 30;

    // 2. Produk Lambat (Dead Stock) - Stok ada tapi tidak laku di data terpilih
    const soldSkus = new Set();
    trxData.forEach(t => t.items.forEach(i => soldSkus.add(i.sku)));
    const deadStock = gudang.filter(p => p.stok > 0 && !soldSkus.has(p.sku)).slice(0, 5);

    // 3. Waktu Teramai
    const hours = {};
    trxData.forEach(t => {
        const h = new Date(t.tanggal).getHours();
        hours[h] = (hours[h] || 0) + 1;
    });
    const busyHour = Object.keys(hours).reduce((a, b) => hours[a] > hours[b] ? a : b, 0);

    let html = `
        <h3 class="font-bold text-xl mb-4 text-indigo-800">🤖 Analisa Bisnis Cerdas</h3>
        
        <div class="bg-indigo-50 p-4 rounded-xl mb-4 border border-indigo-100">
            <h4 class="font-bold text-indigo-700 mb-2">📈 Performa & Prediksi</h4>
            <p class="text-sm text-slate-700">Rata-rata omzet per transaksi: <b>Rp ${parseInt(avgDaily).toLocaleString()}</b>.</p>
            <p class="text-sm text-slate-700 mt-1">Jika tren berlanjut, potensi omzet bulan depan: <b>Rp ${parseInt(prediction).toLocaleString()}</b>.</p>
            <p class="text-sm text-slate-700 mt-1">Jam tersibuk toko Anda adalah pukul <b>${busyHour}:00 - ${parseInt(busyHour)+1}:00</b>.</p>
        </div>

        <div class="bg-orange-50 p-4 rounded-xl mb-4 border border-orange-100">
            <h4 class="font-bold text-orange-700 mb-2">⚠️ Perhatian (Dead Stock)</h4>
            <p class="text-xs text-slate-600 mb-2">Produk ini memiliki stok tapi belum terjual di periode ini:</p>
            <ul class="list-disc pl-4 text-sm text-slate-700">
                ${deadStock.length > 0 ? deadStock.map(p => `<li>${p.nama} (Stok: ${p.stok})</li>`).join('') : '<li>Tidak ada stok mati. Bagus!</li>'}
            </ul>
            ${deadStock.length > 0 ? '<p class="text-xs text-orange-600 mt-2">Saran: Buat diskon atau bundle untuk produk di atas.</p>' : ''}
        </div>

        <button onclick="tutupStruk()" class="w-full py-3 bg-slate-800 text-white font-bold rounded-xl shadow-lg">Tutup Analisa</button>
    `;

    const area = document.getElementById('receipt-area');
    area.innerHTML = html;
    document.getElementById('modal-struk').classList.remove('hidden');
    document.getElementById('modal-struk').classList.add('flex');
}

// [CANGGIH] Render Chart menggunakan Chart.js
async function renderSalesChart(salesData, startDate, endDate) {
    // [OPTIMASI] Load Library Chart
    try {
        await loadScript('https://cdn.jsdelivr.net/npm/chart.js');
    } catch(e) {
        document.getElementById('sales-chart-container').innerHTML = '<p class="text-center text-red-400 py-10">Gagal memuat grafik.</p>';
        return;
    }

    const container = document.getElementById('sales-chart-container');
    container.innerHTML = '<canvas id="salesChart" style="width:100%; height:100%;"></canvas>';

    const allDays = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        allDays.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }

    const labels = allDays.map(d => d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }));
    const data = allDays.map(d => salesData[d.toISOString().split('T')[0]] || 0);

    if (typeof Chart === 'undefined') {
        container.innerHTML = '<p class="text-center text-red-400 py-10">Memuat grafik canggih...</p>';
        return;
    }

    const ctx = document.getElementById('salesChart').getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Omzet Penjualan',
                data: data,
                borderColor: '#0d9488', // Teal 600
                backgroundColor: 'rgba(13, 148, 136, 0.1)',
                borderWidth: 2,
                tension: 0.4, // Smooth curves
                fill: true,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#0d9488',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return 'Rp ' + context.parsed.y.toLocaleString('id-ID');
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { borderDash: [2, 4], color: '#f1f5f9' },
                    ticks: { callback: (val) => (val/1000) + 'k' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

// --- DASHBOARD ---
function renderDashboard() {
    // Omzet & Transaksi Hari Ini
    const today = new Date().toDateString();
    const trxHariIni = riwayat.filter(t => new Date(t.tanggal).toDateString() === today);
    const totalOmzetHariIni = trxHariIni.reduce((sum, t) => sum + t.total, 0);
    document.getElementById('db-omzet-hari-ini').innerText = `Rp ${totalOmzetHariIni.toLocaleString()}`;
    document.getElementById('db-transaksi-hari-ini').innerText = trxHariIni.length;

    // [BARU] Total Piutang
    const totalPiutang = pelanggan.reduce((sum, p) => sum + (p.hutang || 0), 0);
    const elPiutang = document.getElementById('db-total-piutang');
    if(elPiutang) elPiutang.innerText = `Rp ${totalPiutang.toLocaleString()}`;

    // Stok Segera Habis (kurang dari 5)
    const lowStockItems = gudang.filter(p => p.stok < 5).sort((a,b) => a.stok - b.stok);
    const lowStockList = document.getElementById('db-low-stock-list');
    if (lowStockItems.length > 0) {
        lowStockList.innerHTML = lowStockItems.map(p => `
            <div class="flex justify-between items-center text-sm p-3 rounded-lg hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
                <span class="font-medium text-slate-700">${escapeHtml(p.nama)}</span>
                <span class="font-bold ${p.stok === 0 ? 'text-gray-400' : 'text-red-500'}">Sisa ${p.stok}</span>
            </div>
        `).join('');
    } else {
        lowStockList.innerHTML = `<p class="text-sm text-slate-400 text-center py-4">Semua stok aman.</p>`;
    }

    // Target Omzet
    const target = settings.targetOmzet || 0;
    const progress = target > 0 ? (totalOmzetHariIni / target) * 100 : 0;
    document.getElementById('db-target-progress').style.width = `${Math.min(100, progress)}%`;
    document.getElementById('db-target-percentage').innerText = `${Math.round(progress)}%`;
    document.getElementById('db-target-value').innerText = `dari Rp ${target.toLocaleString()}`;

    // [BARU] Notifikasi Kedaluwarsa (H-30)
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + 30); // Peringatan 30 hari kedepan
    const todayDate = new Date();
    todayDate.setHours(0,0,0,0);

    // [LOGIKA BARU] Cek Expired per Batch
    let expiredItems = [];
    gudang.forEach(p => {
        if (p.batches && p.batches.length > 0) {
            // Cek setiap batch
            p.batches.forEach(b => {
                if (b.expired) {
                    const exp = new Date(b.expired);
                    if (exp <= warningDate) {
                        expiredItems.push({ ...p, expiredDate: b.expired, stokBatch: b.qty });
                    }
                }
            });
        } else if (p.expiredDate && p.stok > 0) {
            // Fallback untuk data lama
            const exp = new Date(p.expiredDate);
            if (exp <= warningDate) expiredItems.push({ ...p, stokBatch: p.stok });
        }
    });
    
    expiredItems.sort((a,b) => new Date(a.expiredDate) - new Date(b.expiredDate));

    const expiredList = document.getElementById('db-expired-list');
    if (expiredItems.length > 0) {
        expiredList.innerHTML = expiredItems.map(p => {
            const exp = new Date(p.expiredDate);
            const isExpired = exp < todayDate;
            const daysLeft = Math.ceil((exp - todayDate) / (1000 * 60 * 60 * 24));
            
            return `
            <div class="flex justify-between items-center text-sm p-3 rounded-lg ${isExpired ? 'bg-red-50 border border-red-100' : 'bg-orange-50 border border-orange-100'} mb-2">
                <div>
                    <div class="font-bold text-slate-700">${escapeHtml(p.nama)}</div>
                    <div class="text-xs ${isExpired ? 'text-red-600 font-bold' : 'text-orange-600'}">${isExpired ? 'SUDAH KEDALUWARSA' : `Exp: ${exp.toLocaleDateString('id-ID')} (${daysLeft} hari lagi)`}</div>
                </div>
                <span class="text-xs font-bold bg-white px-2 py-1 rounded border shadow-sm">Batch: ${p.stokBatch}</span>
            </div>`;
        }).join('');
    } else {
        expiredList.innerHTML = `<p class="text-sm text-slate-400 text-center py-4">Tidak ada produk mendekati kedaluwarsa.</p>`;
    }

    // Produk Terlaris Hari Ini
    const topSellingList = document.getElementById('db-top-selling-list');
    
    const productSales = {};
    trxHariIni.forEach(t => {
        t.items.forEach(i => {
            productSales[i.sku] = (productSales[i.sku] || 0) + i.qty;
        });
    });

    const sortedSales = Object.keys(productSales).map(sku => {
        const produk = gudang.find(p => p.sku === sku);
        return {
            nama: produk ? produk.nama : sku,
            qty: productSales[sku]
        };
    }).sort((a, b) => b.qty - a.qty).slice(0, 5);

    if (sortedSales.length > 0) {
        topSellingList.innerHTML = sortedSales.map((p, i) => `
            <div class="flex justify-between items-center p-3 border-b border-slate-100 last:border-b-0">
                <div class="flex items-center gap-3">
                    <span class="font-bold text-slate-400 text-sm w-5 text-center">${i+1}.</span>
                    <span class="text-sm font-medium text-slate-700">${escapeHtml(p.nama)}</span>
                </div>
                <span class="text-xs font-bold bg-teal-50 text-teal-600 px-2 py-1 rounded-md">${p.qty} Terjual</span>
            </div>
        `).join('');
    } else {
        topSellingList.innerHTML = `<p class="text-sm text-slate-400 text-center py-4">Belum ada penjualan hari ini.</p>`;
    }
}

function setTargetOmzet() {
    const newTarget = prompt("Masukkan target omzet harian:", settings.targetOmzet);
    if(newTarget) {
        settings.targetOmzet = parseInt(newTarget) || 0;
        localStorage.setItem('app_settings', JSON.stringify(settings));
        renderDashboard();
    }
}

// --- FITUR BARU: EXPORT CSV ---
function exportLaporanToCSV() {
    if (riwayat.length === 0) {
        return showToast("Tidak ada data laporan untuk diekspor", "info");
    }

    // [FIX] Tambahkan BOM agar Excel bisa membaca karakter UTF-8 (Rupiah, dll) dengan benar
    let csvContent = "ID Transaksi,Tanggal,Waktu,Tipe,SKU,Nama Produk,Jumlah,Harga Satuan,Subtotal\r\n";

    riwayat.forEach(trx => {
        const tanggal = new Date(trx.tanggal).toLocaleDateString('id-ID');
        const waktu = new Date(trx.tanggal).toLocaleTimeString('id-ID');
        const tipe = trx.isDebtPayment ? "Bayar Hutang" : "Penjualan";
        trx.items.forEach(item => {
            const row = [
                `"${trx.id}"`,
                `"${tanggal}"`,
                `"${waktu}"`,
                `"${tipe}"`,
                `"${item.sku}"`,
                `"${item.nama}"`,
                item.qty,
                item.harga,
                item.harga * item.qty
            ].join(",");
            csvContent += row + "\r\n";
        });
    });

    // [BARU] Gunakan Blob untuk menangani data besar
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `laporan_transaksi_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Laporan CSV berhasil diunduh", "success");
}

// [MUTAKHIR] Export Laporan PDF Profesional
async function exportLaporanToPDF() {
    try {
        showToast("Memuat modul PDF...", "info");
        // Lazy Load Library PDF agar aplikasi tetap ringan di awal
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.29/jspdf.plugin.autotable.min.js');
    } catch(e) {
        return showToast("Gagal memuat modul PDF. Cek internet.", "error");
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Header Laporan
    doc.setFontSize(16);
    doc.setTextColor(13, 148, 136); // Teal color
    doc.text(profilToko.nama, 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(profilToko.alamat, 14, 26);
    doc.text(`Periode Laporan: ${document.getElementById('tgl-mulai').value} s/d ${document.getElementById('tgl-selesai').value}`, 14, 32);

    // Filter Data Sesuai Tanggal
    const tglMulai = new Date(document.getElementById('tgl-mulai').value);
    tglMulai.setHours(0, 0, 0, 0);
    const tglSelesai = new Date(document.getElementById('tgl-selesai').value);
    tglSelesai.setHours(23, 59, 59, 999);

    const data = riwayat.filter(t => {
        const d = new Date(t.tanggal);
        return d >= tglMulai && d <= tglSelesai;
    }).map(t => [
        new Date(t.tanggal).toLocaleDateString('id-ID'),
        t.id,
        t.items.map(i => i.nama).join(', '),
        `Rp ${t.total.toLocaleString()}`,
        t.metode.toUpperCase()
    ]);

    // Generate Tabel Otomatis
    doc.autoTable({
        head: [['Tanggal', 'ID TRX', 'Item', 'Total', 'Metode']],
        body: data,
        startY: 40,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [13, 148, 136] }
    });

    // Footer Ringkasan
    const finalY = doc.lastAutoTable.finalY + 10;
    const totalOmzet = document.getElementById('lpr-total-omzet').innerText;
    const labaBersih = document.getElementById('lpr-laba-bersih').innerText;
    
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Total Omzet: ${totalOmzet}`, 14, finalY);
    doc.text(`Laba Bersih: ${labaBersih}`, 14, finalY + 6);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Dicetak otomatis oleh KasirPintar Pro pada: ${new Date().toLocaleString('id-ID')}`, 14, finalY + 15);

    doc.save(`Laporan_Keuangan_${new Date().toISOString().slice(0,10)}.pdf`);
    showToast("Laporan PDF Berhasil Diunduh!", "success");
}

// [MUTAKHIR] Export Data Stok ke CSV/Excel
function exportStokToCSV() {
    if (gudang.length === 0) return showToast("Data stok kosong.", "error");
    
    let csv = "SKU,Nama Produk,Kategori,Harga Jual,Harga Modal,Stok,Nilai Aset (Modal x Stok)\n";
    gudang.forEach(p => {
        // Escape koma dalam nama produk
        const namaSafe = p.nama.replace(/,/g, " ");
        csv += `"${p.sku}","${namaSafe}","${p.kategori || '-'}","${p.harga}","${p.modal}","${p.stok}","${p.stok * p.modal}"\n`;
    });

    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Data_Stok_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Data Stok Berhasil Diunduh!", "success");
}

// BACKUP & RESTORE
function backupData() {
    if (gudang.length === 0 && riwayat.length === 0 && pelanggan.length === 0) {
        return showToast("Tidak ada data untuk di-backup", "info");
    }
    const data = { gudang, riwayat, pelanggan, profilToko, settingPajak, stockLog, pengeluaran, vouchers, settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_kasirpro_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Backup data berhasil diunduh", "success");
}

function restoreData(input) {
    const file = input.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if(confirm("Yakin pulihkan data dari file ini? Data saat ini akan ditimpa.")) {
                if(data.gudang) {
                    gudang = data.gudang || [];
                    riwayat = data.riwayat || [];
                    pelanggan = data.pelanggan || [];
                    stockLog = data.stockLog || [];
                    pengeluaran = data.pengeluaran || [];
                    vouchers = data.vouchers || [];
                    settings = data.settings || settings;
                    localStorage.setItem('gudang_data', JSON.stringify(gudang));
                    localStorage.setItem('riwayat_transaksi', JSON.stringify(riwayat));
                    localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
                    localStorage.setItem('stock_log', JSON.stringify(stockLog));
                    localStorage.setItem('pengeluaran_data', JSON.stringify(pengeluaran));
                    localStorage.setItem('vouchers_data', JSON.stringify(vouchers));
                    localStorage.setItem('app_settings', JSON.stringify(settings));
                    if(data.profilToko) localStorage.setItem('profil_toko', JSON.stringify(data.profilToko));
                    if(data.settingPajak) localStorage.setItem('setting_pajak', data.settingPajak);
                    showToast("Data berhasil dipulihkan!", "success");
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showToast("Format file backup salah!", "error");
                }
            }
        } catch(err) {
            showToast("File backup rusak atau tidak valid!", "error");
        }
    };
    reader.readAsText(file);
    input.value = ''; // Reset input file
}

function resetAplikasi() {
    if(confirm("PERINGATAN: Yakin hapus SEMUA data produk dan transaksi? Aksi ini tidak bisa dikembalikan!")) {
        if(confirm("KONFIRMASI KEDUA: Anda benar-benar yakin ingin menghapus seluruh data?")) {
            localStorage.clear();
            location.reload();
        }
    }
}

// [MUTAKHIR] Storage Manager (Cek Penggunaan Memori)
function updateStorageInfo() {
    if(!navigator.storage || !navigator.storage.estimate) return;
    
    navigator.storage.estimate().then(estimate => {
        const usedMB = (estimate.usage / (1024 * 1024)).toFixed(2);
        // const quotaMB = (estimate.quota / (1024 * 1024)).toFixed(2); // Biasanya besar sekali
        
        // Hitung manual localStorage (karena estimate() menghitung cache SW juga)
        let lsTotal = 0;
        for(let x in localStorage) {
            if(localStorage.hasOwnProperty(x)) lsTotal += ((localStorage[x].length * 2)/1024/1024);
        }
        
        const el = document.getElementById('storage-info-text');
        if(el) el.innerHTML = `Penyimpanan Data: <b>${lsTotal.toFixed(2)} MB</b> terpakai.<br><span class="text-xs text-gray-400">Total Cache Aplikasi: ${usedMB} MB</span>`;
    });
}

// [BARU] Fitur Bersihkan Data Lama
function bersihkanDataLama() {
    if(!confirm("Hapus riwayat transaksi yang lebih lama dari 30 hari untuk menghemat memori?")) return;
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const oldLength = riwayat.length;
    riwayat = riwayat.filter(t => new Date(t.tanggal) > thirtyDaysAgo);
    
    if(riwayat.length < oldLength) {
        localStorage.setItem('riwayat_transaksi', JSON.stringify(riwayat));
        renderLaporan();
        showToast(`Berhasil menghapus ${oldLength - riwayat.length} transaksi lama.`, "success");
        updateStorageInfo();
    } else {
        showToast("Tidak ada data lama yang perlu dihapus.", "info");
    }
}

function resetCart() { 
    if(cart.length > 0 && confirm("Kosongkan semua item di keranjang?")) {
        cart = []; 
        renderCart(); 
    }
}

// [BARU] LOGIKA SHIFT KASIR
function checkShiftStatus() {
    if (!activeShift) {
        document.getElementById('modal-buka-shift').classList.remove('hidden');
        document.getElementById('modal-buka-shift').classList.add('flex');
        setTimeout(() => document.getElementById('shift-modal-awal').focus(), 100);
    }
}

function prosesBukaShift() {
    const modal = parseInt(document.getElementById('shift-modal-awal').value);
    if(isNaN(modal)) return showToast("Masukkan nominal modal awal!", "error");

    activeShift = {
        id: 'SH-' + Date.now(),
        buka: new Date().toISOString(),
        kasir: currentUser.nama,
        modalAwal: modal
    };
    localStorage.setItem('active_shift', JSON.stringify(activeShift));
    
    document.getElementById('modal-buka-shift').classList.add('hidden');
    document.getElementById('modal-buka-shift').classList.remove('flex');
    showToast("Shift Kasir Dibuka. Selamat Bekerja!", "success");
    renderDashboard();
}

function konfirmasiTutupShift() {
    if(!activeShift) return showToast("Shift belum dibuka!", "error");
    
    // Hitung Ringkasan Arus Kas
    const start = new Date(activeShift.buka);
    const now = new Date();
    
    // 1. Total Penjualan Tunai di sesi ini
    const trxSesi = riwayat.filter(t => {
        const tDate = new Date(t.tanggal);
        // [LOGIKA BARU] Hitung Penjualan Tunai DAN Pembayaran Hutang Tunai sebagai uang masuk
        return tDate >= start && tDate <= now && t.metode === 'tunai';
    });
    // Asumsi: Uang masuk = Total Tagihan (karena kembalian dikeluarkan dari laci)
    const totalTunai = trxSesi.reduce((sum, t) => sum + t.total, 0); 
    
    // 2. Hitung Arus Kas Non-Transaksi (Kas Masuk & Keluar)
    const arusKasSesi = pengeluaran.filter(p => {
        const pDate = new Date(p.tanggal);
        return pDate >= start && pDate <= now;
    });
    
    const totalKeluar = arusKasSesi
        .filter(p => p.jenis === 'keluar')
        .reduce((sum, p) => sum + p.nominal, 0);
        
    const totalMasukLain = arusKasSesi
        .filter(p => p.jenis === 'masuk')
        .reduce((sum, p) => sum + p.nominal, 0);
    
    // 3. Saldo Seharusnya
    const expected = activeShift.modalAwal + totalTunai + totalMasukLain - totalKeluar;
    
    document.getElementById('shift-info-modal').innerText = `Rp ${activeShift.modalAwal.toLocaleString()}`;
    document.getElementById('shift-info-masuk').innerText = `Rp ${totalTunai.toLocaleString()}`;
    // Tampilkan info tambahan jika ada kas masuk lain
    if(totalMasukLain > 0) {
        document.getElementById('shift-info-masuk-lain').innerText = `Rp ${totalMasukLain.toLocaleString()}`;
        document.getElementById('row-masuk-lain').classList.remove('hidden');
    } else {
        document.getElementById('row-masuk-lain').classList.add('hidden');
    }
    document.getElementById('shift-info-keluar').innerText = `Rp ${totalKeluar.toLocaleString()}`;
    document.getElementById('shift-info-expected').innerText = `Rp ${expected.toLocaleString()}`;
    document.getElementById('shift-expected-val').value = expected;
    
    document.getElementById('modal-tutup-shift').classList.remove('hidden');
    document.getElementById('modal-tutup-shift').classList.add('flex');
}

function prosesTutupShift() {
    const actual = parseInt(document.getElementById('shift-uang-fisik').value) || 0;
    const expected = parseInt(document.getElementById('shift-expected-val').value) || 0;
    const selisih = actual - expected;
    
    activeShift.tutup = new Date().toISOString();
    activeShift.uangFisik = actual;
    activeShift.expected = expected;
    activeShift.selisih = selisih;
    
    shiftLog.unshift(activeShift);
    localStorage.setItem('shift_log', JSON.stringify(shiftLog));
    localStorage.removeItem('active_shift');
    activeShift = null;
    
    showToast("Shift Ditutup. Logout otomatis...", "success");
    setTimeout(() => { location.reload(); }, 1500);
}

// [BARU] Toggle Lite Mode
function toggleLiteMode(isLite) {
    settings.liteMode = isLite;
    localStorage.setItem('app_settings', JSON.stringify(settings));
    if(isLite) {
        document.body.classList.add('lite-mode');
    } else {
        document.body.classList.remove('lite-mode');
    }
    showToast(`Mode Hemat Daya ${isLite ? 'Aktif' : 'Non-Aktif'}`, 'success');
}

// [CANGGIH] SISTEM LOGIN PIN
let loginPin = "";

function inputLogin(n) {
    if (loginPin.length < 6) {
        loginPin += n;
        updateLoginUI();
    }
}

function hapusLogin() {
    loginPin = loginPin.slice(0, -1);
    updateLoginUI();
}

function updateLoginUI() {
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach((d, i) => {
        if (i < loginPin.length) d.classList.add('bg-teal-600', 'scale-110');
        else d.classList.remove('bg-teal-600', 'scale-110');
    });
}

function processLogin() {
    const user = users.find(u => u.pin === loginPin);
    if (user) {
        currentUser = user;
        sessionStorage.setItem('logged_user', JSON.stringify(user));
        document.getElementById('login-screen').classList.add('hidden');
        initAfterLogin();
        // [FIX] Replace state agar tidak bisa back ke login
        history.replaceState({ page: 'dashboard' }, '', '#dashboard');
        showToast(`Selamat Datang, ${user.nama}`);
    } else {
        showToast("PIN Salah!", "error");
        loginPin = "";
        updateLoginUI();
        if(navigator.vibrate) navigator.vibrate(200);
    }
}

function logout() {
    if(confirm("Keluar dari aplikasi?")) {
        currentUser = null;
        sessionStorage.removeItem('logged_user');
        location.reload();
    }
}

function initAfterLogin() {
    // Set nama toko di header
    document.getElementById('header-nama-toko').innerHTML = profilToko.nama;
    
    // Tampilkan badge user
    const badge = document.getElementById('user-badge');
    badge.classList.remove('hidden');
    badge.innerText = currentUser.role === 'admin' ? 'OWNER' : 'KASIR';
    badge.className = currentUser.role === 'admin' 
        ? "text-[10px] font-bold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full inline-block mb-1"
        : "text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full inline-block mb-1";
    
    bukaHalaman('dashboard', null, false); // False = jangan push state saat init
    updateClock(); 
    setInterval(updateClock, 1000);
    updateNetworkStatus();
    setupVoiceSearch();
    checkShiftStatus(); // [BARU] Cek shift saat login
    
    // Apply Lite Mode
    if(settings.liteMode) {
        document.body.classList.add('lite-mode');
    }
}

// Inisialisasi Aplikasi
window.onload = () => { 
    // Cek Login
    if(!currentUser) {
        document.getElementById('login-screen').classList.remove('hidden');
    } else {
        document.getElementById('login-screen').classList.add('hidden');
        initAfterLogin();
    }

    // Tambahkan event listener untuk search dengan debounce
    const searchInput = document.getElementById('in-search');
    const debouncedSearch = debounce((value) => doSearch(value), 300);
    searchInput.addEventListener('keyup', (e) => {
        debouncedSearch(e.target.value);
    });
};

// [BARU] IMPLEMENTASI FITUR MEJA & HUTANG (Missing Functions)
function renderMeja() {
    const container = document.getElementById('grid-meja');
    if(!container) return;
    
    container.innerHTML = mejaData.map(m => `
        <div onclick="pilihMeja(${m.id})" class="p-4 rounded-xl border cursor-pointer flex flex-col items-center justify-center gap-2 transition-all ${m.status === 'terisi' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-teal-50 hover:border-teal-300'}">
            <span class="font-bold text-xl">Meja ${m.id}</span>
            <span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${m.status === 'terisi' ? 'bg-red-100' : 'bg-slate-100'}">${m.status}</span>
            ${m.pesanan.length > 0 ? `<span class="text-[10px] bg-white px-2 py-1 rounded-full border shadow-sm mt-1">${m.pesanan.length} Item</span>` : ''}
        </div>
    `).join('');
}

function pilihMeja(id) {
    activeTableId = id;
    const meja = mejaData.find(m => m.id === id);
    if(meja.status === 'terisi') {
        cart = [...meja.pesanan];
        renderCart();
        bukaHalaman('kasir');
        showToast(`Meja ${id} dipilih (Terisi)`, 'info');
    } else {
        if(confirm(`Buka Meja ${id} untuk pesanan baru?`)) {
            meja.status = 'terisi';
            meja.pesanan = [];
            localStorage.setItem('meja_data', JSON.stringify(mejaData));
            renderMeja();
            
            cart = [];
            renderCart();
            bukaHalaman('kasir');
            showToast(`Meja ${id} dibuka`, 'success');
        }
    }
}

function tambahMeja() {
    const id = mejaData.length + 1;
    mejaData.push({ id, status: 'kosong', pesanan: [] });
    localStorage.setItem('meja_data', JSON.stringify(mejaData));
    renderMeja();
    showToast(`Meja ${id} ditambahkan`, 'success');
}

function tutupMejaAktif() {
    activeTableId = null;
}

function renderHutang() {
    const list = document.getElementById('list-hutang');
    if(!list) return;
    
    const yangBerhutang = pelanggan.filter(p => p.hutang && p.hutang > 0);
    
    if(yangBerhutang.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 py-10 flex flex-col items-center"><svg class="w-12 h-12 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l4 4a1 1 0 01.586 1.414V19a2 2 0 01-2 2z"></path></svg><span>Tidak ada data hutang.</span></div>';
        return;
    }
    
    list.innerHTML = yangBerhutang.map(p => `
        <div class="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-100 mb-3 shadow-sm">
            <div>
                <div class="font-bold text-slate-800 text-base">${escapeHtml(p.nama)}</div>
                <div class="text-xs text-slate-500 mt-0.5">${escapeHtml(p.nohp)}</div>
            </div>
            <div class="text-right">
                <div class="font-bold text-red-600 text-lg">Rp ${p.hutang.toLocaleString()}</div>
                <button onclick="bayarHutang('${p.id}')" class="text-xs font-bold bg-teal-50 text-teal-700 px-3 py-1.5 rounded-lg mt-1 hover:bg-teal-100 transition">Bayar</button>
            </div>
        </div>
    `).join('');
}

function bayarHutang(id) {
    const p = pelanggan.find(x => x.id === id);
    if(!p) return;
    
    const input = prompt(`Bayar hutang untuk ${p.nama}\nSisa Hutang: Rp ${p.hutang.toLocaleString()}\n\nMasukkan nominal pembayaran:`);
    if(input) {
        const nominal = parseInt(input.replace(/\D/g,''));
        if(!nominal || nominal <= 0) return showToast("Nominal tidak valid", "error");
        
        if(nominal > p.hutang) {
            showToast("Nominal melebihi sisa hutang!", "error");
            return;
        }
        
        p.hutang -= nominal;
        
        // [LOGIKA BARU] Catat sebagai Transaksi agar masuk Laporan Arus Kas (Shift)
        // Ini penting agar uang di laci sesuai saat tutup shift
        const trxHutang = {
            id: 'DEBT-' + Date.now(),
            tanggal: new Date().toISOString(),
            items: [{
                sku: 'DEBT-PAY',
                nama: `Bayar Hutang (${p.nama})`,
                harga: nominal,
                qty: 1,
                diskon: 0
            }],
            subtotal: nominal,
            diskonGlobal: 0,
            pajak: 0,
            total: nominal,
            bayar: nominal,
            kembali: 0,
            pelanggan: { nama: p.nama, id: p.id, nohp: p.nohp },
            metode: 'tunai',
            isDebtPayment: true // Flag khusus untuk membedakan dengan penjualan produk
        };
        
        riwayat.push(trxHutang);
        localStorage.setItem('riwayat_transaksi', JSON.stringify(riwayat));
        localStorage.setItem('pelanggan_data', JSON.stringify(pelanggan));
        renderHutang();
        showToast(`Pembayaran Rp ${nominal.toLocaleString()} berhasil diterima`, "success");
    }
}
