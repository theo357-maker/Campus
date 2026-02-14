// ============================================
// CONFIGURATION FIREBASE
// ============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { getFirestore, collection, getDocs, query, where, addDoc, serverTimestamp, doc, updateDoc, orderBy, getDoc, setDoc, onSnapshot, limit, writeBatch, deleteDoc } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-messaging.js";

// Configuration Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBn7VIddclO7KtrXb5sibCr9SjVLjOy-qI",
  authDomain: "theo1d.firebaseapp.com",
  projectId: "theo1d",
  storageBucket: "theo1d.firebasestorage.app",
  messagingSenderId: "269629842962",
  appId: "1:269629842962:web:a80a12b04448fe1e595acb",
  measurementId: "G-TNSG1XFMDZ"
};

// Initialiser Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let messaging = null;

// Clé VAPID pour FCM
const VAPID_KEY = "BM8H6cADaP6tiA4t9Oc9D36jk1UmYoUBV3cATlJ5mvZ_-eQ5xd6HgX5twxWvZ2U2Y98HBkJ8bTph7epPJJYqBpc";

// Configuration Cloudinary
const CLOUDINARY_CONFIG = {
    cloudName: 'diwn8sxtn',
    uploadPreset: 'cs_lacolombe'
};

// ============================================
// VARIABLES GLOBALES
// ============================================
let currentParent = null;
let childrenList = [];
let parentPhotoFile = null;
let currentGradesPeriod = 'P1';
let notifications = [];
let verifiedChildren = [];
let notificationListeners = [];

// ============================================
// INITIALISATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Application démarrée');
    
    // Initialiser le service worker
    await registerServiceWorker();
    
    // Charger les notifications sauvegardées
    loadNotificationsFromStorage();
    
    // Configurer les écouteurs d'événements
    setupEventListeners();
    
    // Initialiser les tooltips Bootstrap
    if (typeof bootstrap !== 'undefined') {
        const tooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
        tooltips.forEach(tooltip => new bootstrap.Tooltip(tooltip));
    }
    
    // Vérifier si l'application est en mode standalone (installée)
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
        console.log('📱 Application installée détectée');
        document.getElementById('install-banner').style.display = 'none';
    }
});

// ============================================
// SERVICE WORKER
// ============================================
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
            console.log('✅ Service Worker enregistré:', registration.scope);
            
            // Vérifier les mises à jour
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showToast('Nouvelle version disponible. Actualisez la page.', 'info');
                    }
                });
            });
            
            return registration;
        } catch (error) {
            console.error('❌ Erreur Service Worker:', error);
        }
    }
    return null;
}

// ============================================
// FIREBASE MESSAGING
// ============================================
async function initializeFirebaseMessaging() {
    try {
        if (!('Notification' in window)) {
            console.log('❌ Notifications non supportées');
            return null;
        }

        const isMessagingSupported = await isSupported();
        if (!isMessagingSupported) {
            console.log('❌ Firebase Messaging non supporté');
            return null;
        }

        messaging = getMessaging(app);

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('❌ Permission refusée');
            return null;
        }

        const registration = await navigator.serviceWorker.getRegistration();
        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration
        });

        if (token) {
            console.log('✅ Token FCM obtenu');
            if (currentParent) {
                await saveFCMToken(token);
            }
        }

        // Écouter les messages en premier plan
        onMessage(messaging, (payload) => {
            console.log('📨 Message reçu:', payload);
            const { title, body } = payload.notification || {};
            sendNotification({
                title: title || 'Nouvelle notification',
                body: body || '',
                type: payload.data?.type || 'general',
                page: payload.data?.page || 'dashboard',
                timestamp: new Date().toISOString()
            });
        });

        return messaging;

    } catch (error) {
        console.error('❌ Erreur initialisation messaging:', error);
        return null;
    }
}

async function saveFCMToken(token) {
    if (!currentParent || !currentParent.matricule) return;
    
    try {
        const parentRef = doc(db, 'parents', currentParent.matricule);
        await updateDoc(parentRef, {
            fcmToken: token,
            fcmTokenUpdatedAt: serverTimestamp(),
            notificationEnabled: true
        });
    } catch (error) {
        console.error('❌ Erreur sauvegarde token:', error);
    }
}

// ============================================
// NOTIFICATIONS LOCALES
// ============================================
function sendNotification(notification) {
    // Ajouter un ID unique
    notification.id = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    notification.read = false;
    
    // Ajouter à la liste
    notifications.unshift(notification);
    
    // Limiter à 50 notifications
    if (notifications.length > 50) {
        notifications = notifications.slice(0, 50);
    }
    
    // Sauvegarder
    saveNotificationsToStorage();
    
    // Mettre à jour les compteurs
    updateNotificationCount(1);
    updateAppBadge();
    updateMenuBadges();
    
    // Afficher un toast
    showNotificationToast(notification);
    
    // Jouer un son (optionnel)
    playNotificationSound();
    
    // Mettre à jour les écrans actifs
    updateActivePageNotifications();
}

function showNotificationToast(notification) {
    const toast = document.createElement('div');
    toast.className = `notification-toast ${notification.type || 'info'}`;
    toast.innerHTML = `
        <div class="toast-header">
            <span class="toast-title">${notification.title || 'Notification'}</span>
            <button class="toast-close" onclick="this.closest('.notification-toast').remove()">&times;</button>
        </div>
        <div class="toast-body">${notification.body || ''}</div>
        <div class="toast-actions">
            <button class="toast-btn toast-btn-primary" onclick="window.viewNotification('${notification.id}')">
                Voir
            </button>
            <button class="toast-btn toast-btn-secondary" onclick="this.closest('.notification-toast').remove()">
                Fermer
            </button>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }
    }, 8000);
}

function playNotificationSound() {
    try {
        const audio = new Audio('/notification.mp3');
        audio.volume = 0.3;
        audio.play().catch(() => {});
    } catch (e) {}
}

async function updateAppBadge() {
    const unreadCount = notifications.filter(n => !n.read).length;
    const badge = document.getElementById('app-icon-badge');
    
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    
    // Mettre à jour le badge navigateur
    if ('setAppBadge' in navigator) {
        try {
            if (unreadCount > 0) {
                await navigator.setAppBadge(unreadCount);
            } else {
                await navigator.clearAppBadge();
            }
        } catch (error) {
            console.error('Erreur badge:', error);
        }
    }
}

function updateNotificationCount(change) {
    const countElement = document.getElementById('notification-count');
    if (!countElement) return;
    
    let currentCount = parseInt(countElement.textContent) || 0;
    currentCount += change;
    if (currentCount < 0) currentCount = 0;
    
    countElement.textContent = currentCount;
    countElement.classList.toggle('hidden', currentCount === 0);
}

function updateMenuBadges() {
    const pages = ['dashboard', 'grades', 'presence-incidents', 'communiques', 'payments', 'homework', 'timetable', 'children', 'profile', 'communication'];
    
    pages.forEach(page => {
        const link = document.querySelector(`.nav-menu a[data-page="${page}"]`);
        if (link) {
            const existingBadge = link.querySelector('.menu-badge');
            if (existingBadge) existingBadge.remove();
            
            const pageNotifications = notifications.filter(n => !n.read && n.page === page).length;
            
            if (pageNotifications > 0) {
                const badge = document.createElement('span');
                badge.className = 'menu-badge';
                badge.textContent = pageNotifications > 9 ? '9+' : pageNotifications;
                link.appendChild(badge);
            }
        }
    });
}

function saveNotificationsToStorage() {
    try {
        localStorage.setItem('parent_notifications', JSON.stringify(notifications));
    } catch (error) {
        console.error('Erreur sauvegarde notifications:', error);
    }
}

function loadNotificationsFromStorage() {
    try {
        const saved = localStorage.getItem('parent_notifications');
        if (saved) {
            notifications = JSON.parse(saved);
            const unreadCount = notifications.filter(n => !n.read).length;
            updateNotificationCount(unreadCount);
            updateAppBadge();
            updateMenuBadges();
        }
    } catch (error) {
        console.error('Erreur chargement notifications:', error);
    }
}

function updateActivePageNotifications() {
    const activePage = document.querySelector('.page.active')?.id;
    if (activePage === 'notifications-page') {
        displayNotifications(document.getElementById('notification-filter')?.value || 'all');
    }
}

// ============================================
// ÉCOUTEURS EN TEMPS RÉEL
// ============================================
function setupRealtimeListeners() {
    if (!currentParent || childrenList.length === 0) return;

    console.log('🔔 Configuration des écouteurs...');
    
    // Nettoyer les anciens écouteurs
    notificationListeners.forEach(unsubscribe => unsubscribe());
    notificationListeners = [];

    childrenList.forEach(child => {
        // Écouter les nouvelles notes (secondaire)
        if (child.type === 'secondary') {
            const gradesQuery = query(
                collection(db, 'parent_grades'),
                where('className', '==', child.class),
                orderBy('publishedAt', 'desc')
            );
            
            const unsubscribe = onSnapshot(gradesQuery, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'added') {
                        const gradeData = change.doc.data();
                        const hasStudentGrade = gradeData.grades?.some(g => 
                            g.studentMatricule === child.matricule
                        );
                        
                        if (hasStudentGrade) {
                            sendNotification({
                                title: '📊 Nouvelle note',
                                body: `${child.fullName} - ${gradeData.subject}`,
                                type: 'grades',
                                page: 'grades',
                                childId: child.matricule,
                                childName: child.fullName,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                });
            });
            notificationListeners.push(unsubscribe);
        }

        // Écouter les incidents
        const incidentsQuery = query(
            collection(db, 'incidents'),
            where('studentMatricule', '==', child.matricule),
            orderBy('createdAt', 'desc')
        );
        
        const unsubscribeIncidents = onSnapshot(incidentsQuery, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const incident = change.doc.data();
                    sendNotification({
                        title: '⚠️ Incident signalé',
                        body: `${child.fullName}: ${incident.type || 'Incident'}`,
                        type: 'incidents',
                        page: 'presence-incidents',
                        childId: child.matricule,
                        childName: child.fullName,
                        timestamp: new Date().toISOString()
                    });
                }
            });
        });
        notificationListeners.push(unsubscribeIncidents);

        // Écouter les devoirs
        if (child.type === 'secondary' || child.type === 'primary') {
            const homeworkQuery = query(
                collection(db, 'homework'),
                where('className', '==', child.class),
                orderBy('createdAt', 'desc')
            );
            
            const unsubscribeHomework = onSnapshot(homeworkQuery, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'added') {
                        const homework = change.doc.data();
                        sendNotification({
                            title: '📚 Nouveau devoir',
                            body: `${child.fullName}: ${homework.subject || 'Devoir'}`,
                            type: 'homework',
                            page: 'homework',
                            childId: child.matricule,
                            childName: child.fullName,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
            });
            notificationListeners.push(unsubscribeHomework);
        }

        // Écouter les présences
        const today = new Date().toISOString().split('T')[0];
        const presenceQuery = query(
            collection(db, 'student_attendance'),
            where('studentId', '==', child.matricule),
            where('date', '==', today)
        );
        
        const unsubscribePresence = onSnapshot(presenceQuery, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const presence = change.doc.data();
                    let statusText = presence.status === 'present' ? 'présent' : 
                                    presence.status === 'absent' ? 'absent' : 'en retard';
                    
                    sendNotification({
                        title: '📅 Présence',
                        body: `${child.fullName} est ${statusText} aujourd'hui`,
                        type: 'presence',
                        page: 'presence-incidents',
                        childId: child.matricule,
                        childName: child.fullName,
                        timestamp: new Date().toISOString()
                    });
                }
            });
        });
        notificationListeners.push(unsubscribePresence);
    });

    // Écouter les communiqués
    if (currentParent) {
        const communiquesQuery = query(
            collection(db, 'parent_communique_relations'),
            where('parentId', '==', currentParent.matricule),
            orderBy('createdAt', 'desc')
        );
        
        const unsubscribeCommuniques = onSnapshot(communiquesQuery, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    sendNotification({
                        title: '📄 Nouveau communiqué',
                        body: 'Un nouveau communiqué de paiement est disponible',
                        type: 'communiques',
                        page: 'communiques',
                        timestamp: new Date().toISOString()
                    });
                }
            });
        });
        notificationListeners.push(unsubscribeCommuniques);
    }
}

// ============================================
// ÉVÉNEMENTS
// ============================================
function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            navigateToPage(page);
        });
    });
    
    // Menu toggle
    document.getElementById('menu-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('collapsed');
    });
    
    // Notification bell
    document.getElementById('notification-bell').addEventListener('click', () => {
        navigateToPage('notifications');
    });
    
    // Déconnexion
    document.getElementById('logout-btn').addEventListener('click', () => {
        signOut(auth);
        showToast('Déconnexion réussie', 'success');
    });
    
    // Connexion
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    
    // Activation de compte
    document.getElementById('show-activation-link').addEventListener('click', (e) => {
        e.preventDefault();
        showActivationForm();
    });
    
    document.getElementById('show-login-link').addEventListener('click', (e) => {
        e.preventDefault();
        showLoginForm();
    });
    
    document.getElementById('back-to-step1').addEventListener('click', (e) => {
        e.preventDefault();
        goToActivationStep(1);
    });
    
    document.getElementById('go-to-login-btn').addEventListener('click', () => {
        showLoginForm();
    });
    
    // Formulaire activation étape 1
    document.getElementById('activation-form-step1').addEventListener('submit', handleActivationStep1);
    
    // Ajouter enfant
    document.getElementById('add-child-btn').addEventListener('click', addChildToActivation);
    
    // Créer compte
    document.getElementById('create-account-btn').addEventListener('click', createParentAccount);
    
    // Profile photo
    document.getElementById('profile-photo').addEventListener('change', handleProfilePhoto);
    
    // Profile form
    document.getElementById('profile-form').addEventListener('submit', updateProfile);
    
    // Enable notifications
    document.getElementById('enable-notifications-btn').addEventListener('click', enableNotifications);
    
    // Test notification
    document.getElementById('test-notification-btn').addEventListener('click', () => {
        sendNotification({
            title: '🔔 Test réussi',
            body: 'Les notifications fonctionnent parfaitement !',
            type: 'test',
            page: 'profile',
            timestamp: new Date().toISOString()
        });
    });
    
    // Ajouter enfant depuis le compte
    document.getElementById('add-child-account-btn').addEventListener('click', () => {
        const modal = new bootstrap.Modal(document.getElementById('add-child-modal'));
        modal.show();
    });
    
    document.getElementById('add-child-form').addEventListener('submit', handleAddChild);
    
    // Vérification matricule en direct
    document.getElementById('new-child-matricule').addEventListener('blur', verifyChildMatricule);
    
    // Sélecteurs enfants
    setupChildSelectors();
    
    // Présences
    document.getElementById('presence-child-selector').addEventListener('change', handlePresenceChildChange);
    document.getElementById('load-presence-btn').addEventListener('click', loadMonthlyPresence);
    
    // Paiements
    document.getElementById('payment-child-selector').addEventListener('change', handlePaymentChildChange);
    document.getElementById('online-payment-form').addEventListener('submit', handlePayment);
    document.getElementById('download-receipt-btn').addEventListener('click', downloadReceipt);
    
    // Devoirs
    setupHomeworkListeners();
    
    // Horaire
    document.getElementById('timetable-child-selector').addEventListener('change', handleTimetableChildChange);
    document.getElementById('load-timetable-btn').addEventListener('click', loadTimetable);
    
    // Communiqués
    document.getElementById('refresh-communiques-btn').addEventListener('click', loadCommuniques);
    document.getElementById('communique-child-selector').addEventListener('change', loadCommuniques);
    document.getElementById('communique-type-filter').addEventListener('change', loadCommuniques);
    document.getElementById('print-communique-btn').addEventListener('click', printCurrentCommunique);
    
    // Cotes et notes
    setupGradesListeners();
}

function navigateToPage(page) {
    // Mettre à jour les classes actives
    document.querySelectorAll('.nav-menu a, .page').forEach(el => el.classList.remove('active'));
    document.querySelector(`.nav-menu a[data-page="${page}"]`).classList.add('active');
    document.getElementById(`${page}-page`).classList.add('active');
    document.getElementById('page-title').textContent = document.querySelector(`.nav-menu a[data-page="${page}"]`).textContent;
    
    // Fermer le menu sur mobile
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.add('collapsed');
    }
    
    // Actions spécifiques
    if (page === 'dashboard') {
        resetDashboard();
    } else if (page === 'presence-incidents') {
        resetPresence();
    } else if (page === 'payments') {
        resetPayments();
    } else if (page === 'timetable') {
        resetTimetable();
    }
    
    // Marquer les notifications comme lues pour cette page
    markPageNotificationsAsRead(page);
}

function markPageNotificationsAsRead(page) {
    let changed = false;
    notifications.forEach(n => {
        if (n.page === page && !n.read) {
            n.read = true;
            changed = true;
        }
    });
    
    if (changed) {
        saveNotificationsToStorage();
        updateNotificationCount(-notifications.filter(n => !n.read).length);
        updateAppBadge();
        updateMenuBadges();
    }
}

// ============================================
// AUTH STATE CHANGED
// ============================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const q = query(collection(db, 'parents'), where('uid', '==', user.uid));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            currentParent = { id: snap.docs[0].id, ...snap.docs[0].data() };
            
            document.getElementById('login-overlay').classList.add('hidden');
            document.getElementById('app-root').classList.remove('hidden');
            document.getElementById('parent-name').textContent = currentParent.fullName;
            
            updateParentPhoto();
            await loadParentData();
            
            await initializeFirebaseMessaging();
            setupRealtimeListeners();
            
            // Vérifier périodiquement les nouvelles données
            setInterval(checkForNewData, 5 * 60 * 1000);
            
            showToast(`Bienvenue ${currentParent.fullName}`, 'success');
        } else {
            await signOut(auth);
            showToast('Accès non autorisé', 'error');
        }
    } else {
        document.getElementById('login-overlay').classList.remove('hidden');
        document.getElementById('app-root').classList.add('hidden');
    }
});

function updateParentPhoto() {
    const container = document.getElementById('parent-photo-container');
    if (currentParent.photoURL) {
        container.innerHTML = `<img src="${currentParent.photoURL}" class="parent-photo" alt="Photo">`;
        document.getElementById('profile-photo-preview').innerHTML = `<img src="${currentParent.photoURL}" class="photo-preview" style="width:100px;height:100px;border-radius:50%;">`;
    } else {
        container.innerHTML = `<div class="parent-photo-placeholder"><i class="fas fa-user"></i></div>`;
    }
}

// ============================================
// CHARGEMENT DES DONNÉES PARENT
// ============================================
async function loadParentData() {
    const childSelectors = [
        document.getElementById('child-selector'),
        document.getElementById('presence-child-selector'),
        document.getElementById('payment-child-selector'),
        document.getElementById('timetable-child-selector'),
        document.getElementById('communique-child-selector')
    ];
    
    const secondarySelectors = [
        document.getElementById('secondary-grades-child-selector'),
        document.getElementById('secondary-homework-child-selector')
    ];
    
    const primarySelectors = [
        document.getElementById('primary-grades-child-selector'),
        document.getElementById('primary-homework-child-selector')
    ];
    
    const kindergartenSelectors = [
        document.getElementById('kindergarten-grades-child-selector'),
        document.getElementById('kindergarten-homework-child-selector')
    ];
    
    // Réinitialiser les sélecteurs
    childSelectors.forEach(s => {
        if (s) s.innerHTML = '<option value="">-- Sélectionner --</option>';
    });
    secondarySelectors.forEach(s => {
        if (s) s.innerHTML = '<option value="">-- Sélectionner --</option>';
    });
    primarySelectors.forEach(s => {
        if (s) s.innerHTML = '<option value="">-- Sélectionner --</option>';
    });
    kindergartenSelectors.forEach(s => {
        if (s) s.innerHTML = '<option value="">-- Sélectionner --</option>';
    });

    if (currentParent && currentParent.children) {
        childrenList = [];
        
        for (const childData of currentParent.children) {
            const childMatricule = childData.matricule || childData;
            const childType = childData.type || 'secondary';
            
            let childDoc;
            if (childType === 'secondary') {
                childDoc = await getDoc(doc(db, 'students', childMatricule));
            } else if (childType === 'primary') {
                childDoc = await getDoc(doc(db, 'primary_students', childMatricule));
            } else {
                childDoc = await getDoc(doc(db, 'kindergarten_students', childMatricule));
            }
            
            if (childDoc.exists()) {
                const childInfo = childDoc.data();
                const childObj = {
                    matricule: childMatricule,
                    type: childType,
                    ...childInfo
                };
                childrenList.push(childObj);
                
                const displayText = `${childInfo.fullName} - ${childInfo.class}`;
                
                childSelectors.forEach(s => {
                    if (s) s.innerHTML += `<option value="${childMatricule}">${displayText}</option>`;
                });
                
                if (childType === 'secondary') {
                    secondarySelectors.forEach(s => {
                        if (s) s.innerHTML += `<option value="${childMatricule}">${displayText}</option>`;
                    });
                } else if (childType === 'primary') {
                    primarySelectors.forEach(s => {
                        if (s) s.innerHTML += `<option value="${childMatricule}">${displayText}</option>`;
                    });
                } else {
                    kindergartenSelectors.forEach(s => {
                        if (s) s.innerHTML += `<option value="${childMatricule}">${displayText}</option>`;
                    });
                }
            }
        }
        
        updateChildrenPage();
        updateProfileForm();
        loadYearSelectors();
    }
}

function updateChildrenPage() {
    const container = document.getElementById('children-list-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (childrenList.length === 0) {
        container.innerHTML = '<p class="text-muted">Aucun enfant associé</p>';
        return;
    }
    
    childrenList.forEach(child => {
        const childElement = document.createElement('div');
        childElement.className = 'card mb-3';
        childElement.innerHTML = `
            <div class="card-body">
                <h5 class="card-title">${child.fullName}</h5>
                <p class="card-text">
                    <strong>Matricule:</strong> ${child.matricule}<br>
                    <strong>Classe:</strong> ${child.class}<br>
                    <strong>Type:</strong> ${child.type === 'secondary' ? 'Secondaire' : child.type === 'primary' ? 'Primaire' : 'Maternelle'}
                </p>
            </div>
        `;
        container.appendChild(childElement);
    });
}

function updateProfileForm() {
    if (currentParent) {
        document.getElementById('profile-matricule').value = currentParent.matricule;
        document.getElementById('profile-fullname').value = currentParent.fullName;
        document.getElementById('profile-email').value = currentParent.email;
        document.getElementById('profile-phone').value = currentParent.phone;
        
        const statusElement = document.getElementById('notification-status');
        if (statusElement) {
            statusElement.innerHTML = currentParent.notificationEnabled ?
                '<span class="text-success"><i class="fas fa-check-circle me-1"></i>Activées</span>' :
                '<span class="text-danger"><i class="fas fa-times-circle me-1"></i>Désactivées</span>';
        }
    }
}

function loadYearSelectors() {
    const currentYear = new Date().getFullYear();
    const yearSelect = document.getElementById('presence-year');
    if (!yearSelect) return;
    
    yearSelect.innerHTML = '';
    for (let year = currentYear - 1; year <= currentYear + 1; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === currentYear) option.selected = true;
        yearSelect.appendChild(option);
    }
    
    const monthSelect = document.getElementById('presence-month');
    if (monthSelect) {
        monthSelect.value = new Date().getMonth();
    }
    
    const timetableMonth = document.getElementById('timetable-month');
    if (timetableMonth) {
        const today = new Date();
        const year = today.getFullYear();
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        timetableMonth.value = `${year}-${month}`;
    }
}

// ============================================
// FONCTIONS DE CONNEXION/ACTIVATION
// ============================================
async function handleLogin(e) {
    e.preventDefault();
    const matricule = document.getElementById('login-matricule').value;
    const password = document.getElementById('login-password').value;
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Connexion...';
    submitBtn.disabled = true;

    try {
        const parentDoc = await getDoc(doc(db, 'parents', matricule));
        if (!parentDoc.exists()) {
            showToast('Matricule incorrect', 'error');
            return;
        }
        
        const parentData = parentDoc.data();
        await signInWithEmailAndPassword(auth, parentData.authEmail, password);
        
    } catch (error) {
        console.error('Erreur connexion:', error);
        showToast('Matricule ou mot de passe incorrect', 'error');
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

function showActivationForm() {
    document.getElementById('login-form').closest('.login-card').classList.add('hidden');
    document.getElementById('activation-card').classList.remove('hidden');
    resetActivationForm();
}

function showLoginForm() {
    document.getElementById('activation-card').classList.add('hidden');
    document.getElementById('login-form').closest('.login-card').classList.remove('hidden');
    resetActivationForm();
}

function resetActivationForm() {
    document.getElementById('activation-form-step1').reset();
    document.getElementById('activation-step-2').classList.add('hidden');
    document.getElementById('activation-step-3').classList.add('hidden');
    document.getElementById('additional-matricule').value = '';
    verifiedChildren = [];
    updateChildrenActivationList();
    goToActivationStep(1);
}

function goToActivationStep(step) {
    document.querySelectorAll('.step').forEach((el, index) => {
        if (index + 1 < step) {
            el.classList.add('completed');
            el.classList.remove('active');
        } else if (index + 1 === step) {
            el.classList.add('active');
            el.classList.remove('completed');
        } else {
            el.classList.remove('active', 'completed');
        }
    });
    
    document.getElementById('activation-step-1').classList.toggle('hidden', step !== 1);
    document.getElementById('activation-step-2').classList.toggle('hidden', step !== 2);
    document.getElementById('activation-step-3').classList.toggle('hidden', step !== 3);
}

function updateChildrenActivationList() {
    const container = document.getElementById('children-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (verifiedChildren.length === 0) {
        container.innerHTML = '<p class="text-muted">Aucun enfant ajouté</p>';
        return;
    }
    
    verifiedChildren.forEach((child, index) => {
        const childElement = document.createElement('div');
        childElement.className = 'alert alert-info d-flex justify-content-between align-items-center';
        childElement.innerHTML = `
            <div>
                <strong>${child.name}</strong><br>
                <small>${child.class}</small>
            </div>
            <button type="button" class="btn btn-danger btn-sm" onclick="removeChild(${index})">
                <i class="fas fa-times"></i>
            </button>
        `;
        container.appendChild(childElement);
    });
}

window.removeChild = (index) => {
    verifiedChildren.splice(index, 1);
    updateChildrenActivationList();
};

async function handleActivationStep1(e) {
    e.preventDefault();
    const childMatricule = document.getElementById('child-matricule').value;
    
    if (!childMatricule) {
        showToast('Veuillez entrer un matricule', 'error');
        return;
    }
    
    try {
        let studentData = null;
        let studentType = null;
        
        // Vérifier dans les trois collections
        let studentDoc = await getDoc(doc(db, 'students', childMatricule));
        if (studentDoc.exists()) {
            studentData = studentDoc.data();
            studentType = 'secondary';
        } else {
            studentDoc = await getDoc(doc(db, 'primary_students', childMatricule));
            if (studentDoc.exists()) {
                studentData = studentDoc.data();
                studentType = 'primary';
            } else {
                studentDoc = await getDoc(doc(db, 'kindergarten_students', childMatricule));
                if (studentDoc.exists()) {
                    studentData = studentDoc.data();
                    studentType = 'kindergarten';
                }
            }
        }
        
        if (!studentData) {
            showToast('Aucun élève trouvé avec ce matricule', 'error');
            return;
        }
        
        if (studentData.parentId) {
            showToast('Cet élève est déjà associé à un compte parent', 'error');
            return;
        }
        
        verifiedChildren = [{
            matricule: childMatricule,
            name: studentData.fullName,
            class: studentData.class,
            type: studentType
        }];
        
        document.getElementById('child-name').textContent = studentData.fullName;
        document.getElementById('child-class').textContent = studentData.class;
        updateChildrenActivationList();
        goToActivationStep(2);
        
    } catch (error) {
        console.error('Erreur:', error);
        showToast('Erreur lors de la vérification', 'error');
    }
}

async function addChildToActivation() {
    const matricule = document.getElementById('additional-matricule').value;
    
    if (!matricule) {
        showToast('Veuillez entrer un matricule', 'error');
        return;
    }
    
    try {
        let studentData = null;
        let studentType = null;
        
        let studentDoc = await getDoc(doc(db, 'students', matricule));
        if (studentDoc.exists()) {
            studentData = studentDoc.data();
            studentType = 'secondary';
        } else {
            studentDoc = await getDoc(doc(db, 'primary_students', matricule));
            if (studentDoc.exists()) {
                studentData = studentDoc.data();
                studentType = 'primary';
            } else {
                studentDoc = await getDoc(doc(db, 'kindergarten_students', matricule));
                if (studentDoc.exists()) {
                    studentData = studentDoc.data();
                    studentType = 'kindergarten';
                }
            }
        }
        
        if (!studentData) {
            showToast('Aucun élève trouvé', 'error');
            return;
        }
        
        if (studentData.parentId) {
            showToast('Cet élève a déjà un parent', 'error');
            return;
        }
        
        if (verifiedChildren.find(child => child.matricule === matricule)) {
            showToast('Déjà dans la liste', 'error');
            return;
        }
        
        verifiedChildren.push({
            matricule: matricule,
            name: studentData.fullName,
            class: studentData.class,
            type: studentType
        });
        
        updateChildrenActivationList();
        document.getElementById('additional-matricule').value = '';
        showToast('Enfant ajouté', 'success');
        
    } catch (error) {
        console.error('Erreur:', error);
        showToast('Erreur lors de l\'ajout', 'error');
    }
}

async function generateParentMatricule() {
    try {
        const parentsQuery = query(collection(db, 'parents'));
        const parentsSnap = await getDocs(parentsQuery);
        
        let maxNumber = 0;
        
        parentsSnap.forEach(doc => {
            const matricule = doc.data().matricule;
            if (matricule && matricule.startsWith('P')) {
                const number = parseInt(matricule.substring(1));
                if (!isNaN(number) && number > maxNumber) {
                    maxNumber = number;
                }
            }
        });
        
        return 'P' + (maxNumber + 1).toString().padStart(3, '0');
        
    } catch (error) {
        console.error('Erreur génération matricule:', error);
        return 'P' + Math.floor(Math.random() * 900 + 100).toString();
    }
}

async function createParentAccount() {
    const fullName = document.getElementById('parent-fullname').value;
    const email = document.getElementById('parent-email').value;
    const phone = document.getElementById('parent-phone').value;
    const password = document.getElementById('parent-password').value;
    const confirmPassword = document.getElementById('parent-password-confirm').value;
    
    if (!fullName || !email || !phone || !password) {
        showToast('Tous les champs sont requis', 'error');
        return;
    }
    
    if (password !== confirmPassword) {
        showToast('Les mots de passe ne correspondent pas', 'error');
        return;
    }
    
    if (password.length < 6) {
        showToast('Le mot de passe doit contenir au moins 6 caractères', 'error');
        return;
    }
    
    if (verifiedChildren.length === 0) {
        showToast('Ajoutez au moins un enfant', 'error');
        return;
    }
    
    try {
        const parentMatricule = await generateParentMatricule();
        const parentEmail = `parent.${parentMatricule}@cs-lacolombe.edu`;
        const userCredential = await createUserWithEmailAndPassword(auth, parentEmail, password);
        const user = userCredential.user;
        
        const parentData = {
            matricule: parentMatricule,
            fullName: fullName,
            email: email,
            phone: phone,
            authEmail: parentEmail,
            uid: user.uid,
            children: verifiedChildren.map(child => ({
                matricule: child.matricule,
                type: child.type
            })),
            notificationEnabled: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        
        await setDoc(doc(db, 'parents', parentMatricule), parentData);
        
        // Mettre à jour les enfants
        for (const child of verifiedChildren) {
            let studentRef;
            if (child.type === 'secondary') {
                studentRef = doc(db, 'students', child.matricule);
            } else if (child.type === 'primary') {
                studentRef = doc(db, 'primary_students', child.matricule);
            } else {
                studentRef = doc(db, 'kindergarten_students', child.matricule);
            }
            
            await updateDoc(studentRef, {
                parentId: parentMatricule,
                parentName: fullName,
                parentEmail: email,
                parentPhone: phone,
                updatedAt: serverTimestamp()
            });
        }
        
        document.getElementById('created-parent-matricule').textContent = parentMatricule;
        document.getElementById('created-parent-name').textContent = fullName;
        document.getElementById('created-parent-email').textContent = email;
        document.getElementById('created-children-count').textContent = verifiedChildren.length;
        goToActivationStep(3);
        
    } catch (error) {
        console.error('Erreur création compte:', error);
        showToast(error.message, 'error');
    }
}

// ============================================
// FONCTIONS PROFIL
// ============================================
function handleProfilePhoto(e) {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 5 * 1024 * 1024) {
            showToast('Photo trop volumineuse (max 5MB)', 'error');
            return;
        }
        if (!file.type.startsWith('image/')) {
            showToast('Veuillez sélectionner une image', 'error');
            return;
        }
        parentPhotoFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('profile-photo-preview').innerHTML = `<img src="${e.target.result}" class="photo-preview" style="width:100px;height:100px;border-radius:50%;">`;
        };
        reader.readAsDataURL(file);
    }
}

async function uploadToCloudinary(file, folder = 'parents') {
    if (!file) return null;
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
        formData.append('folder', folder);
        
        const response = await fetch(
            `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`,
            { method: 'POST', body: formData }
        );
        
        if (!response.ok) throw new Error('Upload échoué');
        
        const data = await response.json();
        return data.secure_url;
        
    } catch (error) {
        console.error('❌ Erreur upload:', error);
        throw error;
    }
}

async function updateProfile(e) {
    e.preventDefault();
    
    const fullName = document.getElementById('profile-fullname').value;
    const email = document.getElementById('profile-email').value;
    const phone = document.getElementById('profile-phone').value;
    const newPassword = document.getElementById('profile-new-password').value;
    const confirmPassword = document.getElementById('profile-confirm-password').value;
    
    if (!fullName || !email || !phone) {
        showToast('Remplissez tous les champs', 'error');
        return;
    }
    
    if (newPassword && newPassword !== confirmPassword) {
        showToast('Les mots de passe ne correspondent pas', 'error');
        return;
    }
    
    try {
        let photoURL = currentParent.photoURL;
        
        if (parentPhotoFile) {
            showToast('Upload de la photo...', 'info');
            photoURL = await uploadToCloudinary(parentPhotoFile, `parents/${currentParent.matricule}`);
        }
        
        const updateData = {
            fullName,
            email,
            phone,
            photoURL,
            updatedAt: serverTimestamp()
        };
        
        await updateDoc(doc(db, 'parents', currentParent.matricule), updateData);
        
        // Mettre à jour les enfants
        for (const child of childrenList) {
            let studentRef;
            if (child.type === 'secondary') {
                studentRef = doc(db, 'students', child.matricule);
            } else if (child.type === 'primary') {
                studentRef = doc(db, 'primary_students', child.matricule);
            } else {
                studentRef = doc(db, 'kindergarten_students', child.matricule);
            }
            
            await updateDoc(studentRef, {
                parentName: fullName,
                parentEmail: email,
                parentPhone: phone,
                updatedAt: serverTimestamp()
            });
        }
        
        if (newPassword) {
            showToast('Mot de passe mis à jour', 'success');
        }
        
        currentParent = { ...currentParent, ...updateData };
        document.getElementById('parent-name').textContent = fullName;
        updateParentPhoto();
        
        showToast('Profil mis à jour avec succès', 'success');
        parentPhotoFile = null;
        
        document.getElementById('profile-new-password').value = '';
        document.getElementById('profile-confirm-password').value = '';
        
    } catch (error) {
        console.error('Erreur:', error);
        showToast('Erreur lors de la mise à jour', 'error');
    }
}

async function enableNotifications() {
    const granted = await Notification.requestPermission();
    if (granted === 'granted') {
        await initializeFirebaseMessaging();
        await updateDoc(doc(db, 'parents', currentParent.matricule), {
            notificationEnabled: true,
            notificationEnabledAt: serverTimestamp()
        });
        currentParent.notificationEnabled = true;
        updateProfileForm();
        showToast('Notifications activées', 'success');
    } else {
        showToast('Permission refusée', 'error');
    }
}

// ============================================
// FONCTIONS DASHBOARD
// ============================================
function resetDashboard() {
    document.getElementById('child-selector').value = '';
    document.getElementById('child-dashboard-content').classList.add('hidden');
}

function setupChildSelectors() {
    document.getElementById('child-selector').addEventListener('change', async (e) => {
        const studentId = e.target.value;
        const dashboardContent = document.getElementById('child-dashboard-content');
        
        if (!studentId) {
            dashboardContent.classList.add('hidden');
            return;
        }
        
        dashboardContent.classList.remove('hidden');
        await loadChildDashboard(studentId);
    });
}

async function loadChildDashboard(studentId) {
    const child = childrenList.find(c => c.matricule === studentId);
    if (!child) return;
    
    // Charger les notes
    await loadDashboardGrades(child);
    
    // Charger les présences
    await loadDashboardAttendance(studentId);
    
    // Charger les devoirs
    await loadDashboardHomework(child);
}

async function loadDashboardGrades(child) {
    const tableBody = document.getElementById('child-grades-table-body');
    if (!tableBody) return;
    
    try {
        if (child.type === 'secondary') {
            const gradesQuery = query(
                collection(db, 'parent_grades'),
                where('className', '==', child.class),
                orderBy('publishedAt', 'desc'),
                limit(5)
            );
            
            const gradesSnap = await getDocs(gradesQuery);
            
            if (gradesSnap.empty) {
                tableBody.innerHTML = '<tr><td colspan="5" class="text-center">Aucune note</td></tr>';
                return;
            }
            
            let html = '';
            gradesSnap.forEach(doc => {
                const gradeData = doc.data();
                const studentGrade = gradeData.grades?.find(g => g.studentMatricule === child.matricule);
                
                if (studentGrade) {
                    const date = gradeData.publishedAt?.toDate().toLocaleDateString('fr-FR') || '';
                    const percentage = ((studentGrade.grade / gradeData.maxPoints) * 100).toFixed(0);
                    html += `
                        <tr>
                            <td>${gradeData.subject}</td>
                            <td>${studentGrade.grade}</td>
                            <td>${gradeData.maxPoints}</td>
                            <td>${percentage}%</td>
                            <td>${date}</td>
                        </tr>
                    `;
                }
            });
            
            tableBody.innerHTML = html || '<tr><td colspan="5" class="text-center">Aucune note</td></tr>';
            
        } else if (child.type === 'primary') {
            const gradesQuery = query(
                collection(db, 'primary_published_grades'),
                where('studentId', '==', child.matricule),
                orderBy('publishedAt', 'desc'),
                limit(5)
            );
            
            const gradesSnap = await getDocs(gradesQuery);
            
            if (gradesSnap.empty) {
                tableBody.innerHTML = '<tr><td colspan="5" class="text-center">Aucune note</td></tr>';
                return;
            }
            
            let html = '';
            gradesSnap.forEach(doc => {
                const gradeData = doc.data();
                gradeData.grades?.forEach(courseGrade => {
                    const date = gradeData.publishedAt?.toDate().toLocaleDateString('fr-FR') || '';
                    const percentage = ((courseGrade.obtainedGrade / courseGrade.maxGrade) * 100).toFixed(0);
                    html += `
                        <tr>
                            <td>${courseGrade.courseName}</td>
                            <td>${courseGrade.obtainedGrade}</td>
                            <td>${courseGrade.maxGrade}</td>
                            <td>${percentage}%</td>
                            <td>${date}</td>
                        </tr>
                    `;
                });
            });
            
            tableBody.innerHTML = html || '<tr><td colspan="5" class="text-center">Aucune note</td></tr>';
        }
        
    } catch (error) {
        console.error('Erreur chargement notes:', error);
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Erreur de chargement</td></tr>';
    }
}

async function loadDashboardAttendance(studentId) {
    const container = document.getElementById('attendance-container');
    if (!container) return;
    
    try {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
        
        const attendanceQuery = query(
            collection(db, 'student_attendance'),
            where('studentId', '==', studentId),
            where('date', '>=', firstDay),
            where('date', '<=', lastDay),
            where('published', '==', true)
        );
        
        const attendanceSnap = await getDocs(attendanceQuery);
        
        let present = 0, absent = 0, late = 0;
        
        attendanceSnap.forEach(doc => {
            const data = doc.data();
            if (data.status === 'present') present++;
            else if (data.status === 'absent') absent++;
            else if (data.status === 'late') late++;
        });
        
        const total = present + absent + late;
        const rate = total > 0 ? ((present / total) * 100).toFixed(0) : 0;
        
        container.innerHTML = `
            <div class="row text-center">
                <div class="col-4">
                    <div class="h3 text-success">${present}</div>
                    <div class="small">Présences</div>
                </div>
                <div class="col-4">
                    <div class="h3 text-danger">${absent}</div>
                    <div class="small">Absences</div>
                </div>
                <div class="col-4">
                    <div class="h3 text-warning">${late}</div>
                    <div class="small">Retards</div>
                </div>
                <div class="col-12 mt-2">
                    <div class="progress">
                        <div class="progress-bar bg-success" style="width: ${rate}%">${rate}%</div>
                    </div>
                </div>
            </div>
        `;
        
    } catch (error) {
        console.error('Erreur chargement présences:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

async function loadDashboardHomework(child) {
    const container = document.getElementById('homework-container');
    if (!container) return;
    
    try {
        if (child.type === 'secondary') {
            const homeworkQuery = query(
                collection(db, 'homework'),
                where('className', '==', child.class),
                where('published', '==', true),
                orderBy('dueDate', 'asc'),
                limit(5)
            );
            
            const homeworkSnap = await getDocs(homeworkQuery);
            
            if (homeworkSnap.empty) {
                container.innerHTML = '<p class="text-muted">Aucun devoir récent</p>';
                return;
            }
            
            let html = '<ul class="list-group">';
            homeworkSnap.forEach(doc => {
                const hw = doc.data();
                const dueDate = hw.dueDate?.toDate().toLocaleDateString('fr-FR') || '';
                html += `
                    <li class="list-group-item">
                        <strong>${hw.subject}</strong><br>
                        <small>${hw.title} - à rendre le ${dueDate}</small>
                    </li>
                `;
            });
            html += '</ul>';
            container.innerHTML = html;
            
        } else {
            container.innerHTML = '<p class="text-muted">Fonctionnalité disponible uniquement pour le secondaire</p>';
        }
        
    } catch (error) {
        console.error('Erreur chargement devoirs:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

// ============================================
// FONCTIONS PRÉSENCES
// ============================================
function resetPresence() {
    document.getElementById('presence-child-selector').value = '';
    document.getElementById('presence-incidents-content').classList.add('hidden');
}

function handlePresenceChildChange(e) {
    const studentId = e.target.value;
    const content = document.getElementById('presence-incidents-content');
    
    if (!studentId) {
        content.classList.add('hidden');
        return;
    }
    
    content.classList.remove('hidden');
    loadChildIncidents(studentId);
}

async function loadChildIncidents(studentId) {
    const container = document.getElementById('incidents-list-container');
    if (!container) return;
    
    container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';
    
    try {
        const incidentsQuery = query(
            collection(db, 'incidents'),
            where('studentMatricule', '==', studentId),
            orderBy('createdAt', 'desc')
        );
        
        const incidentsSnap = await getDocs(incidentsQuery);
        
        if (incidentsSnap.empty) {
            container.innerHTML = '<p class="text-muted">Aucun incident signalé</p>';
            return;
        }
        
        let html = '';
        incidentsSnap.forEach(doc => {
            const incident = doc.data();
            const date = incident.createdAt?.toDate().toLocaleDateString('fr-FR') || '';
            const severityClass = incident.severity === 'eleve' ? 'danger' : 
                                incident.severity === 'moyen' ? 'warning' : 'info';
            
            html += `
                <div class="alert alert-${severityClass} mb-3">
                    <div class="d-flex justify-content-between">
                        <strong>${incident.type || 'Incident'}</strong>
                        <small>${date}</small>
                    </div>
                    <p class="mb-0">${incident.description || 'Aucune description'}</p>
                </div>
            `;
        });
        
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Erreur chargement incidents:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

async function loadMonthlyPresence() {
    const studentId = document.getElementById('presence-child-selector').value;
    const month = parseInt(document.getElementById('presence-month').value);
    const year = parseInt(document.getElementById('presence-year').value);
    
    if (!studentId) {
        showToast('Sélectionnez un enfant', 'error');
        return;
    }
    
    const container = document.getElementById('monthly-presence-container');
    const statsContainer = document.getElementById('presence-stats');
    
    container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';
    
    try {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        
        const startDate = firstDay.toISOString().split('T')[0];
        const endDate = lastDay.toISOString().split('T')[0];
        
        const attendanceQuery = query(
            collection(db, 'student_attendance'),
            where('studentId', '==', studentId),
            where('date', '>=', startDate),
            where('date', '<=', endDate),
            where('published', '==', true)
        );
        
        const attendanceSnap = await getDocs(attendanceQuery);
        
        const presenceMap = {};
        let present = 0, absent = 0, late = 0;
        
        attendanceSnap.forEach(doc => {
            const data = doc.data();
            presenceMap[data.date] = data.status;
            if (data.status === 'present') present++;
            else if (data.status === 'absent') absent++;
            else if (data.status === 'late') late++;
        });
        
        const total = present + absent + late;
        const rate = total > 0 ? ((present / total) * 100).toFixed(1) : 0;
        
        // Statistiques
        statsContainer.innerHTML = `
            <div class="col-md-3">
                <div class="card text-center">
                    <div class="card-body">
                        <h3 class="text-success">${present}</h3>
                        <p class="mb-0">Présences</p>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card text-center">
                    <div class="card-body">
                        <h3 class="text-danger">${absent}</h3>
                        <p class="mb-0">Absences</p>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card text-center">
                    <div class="card-body">
                        <h3 class="text-warning">${late}</h3>
                        <p class="mb-0">Retards</p>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card text-center">
                    <div class="card-body">
                        <h3 class="text-primary">${rate}%</h3>
                        <p class="mb-0">Taux</p>
                    </div>
                </div>
            </div>
        `;
        
        // Calendrier
        let calendarHTML = '<div class="row g-2">';
        
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
            const status = presenceMap[dateStr];
            
            let bgClass = 'bg-light';
            let text = day;
            
            if (status === 'present') {
                bgClass = 'bg-success text-white';
                text = '✓';
            } else if (status === 'absent') {
                bgClass = 'bg-danger text-white';
                text = '✗';
            } else if (status === 'late') {
                bgClass = 'bg-warning';
                text = '⌚';
            }
            
            calendarHTML += `
                <div class="col-2 col-sm-1">
                    <div class="p-2 text-center ${bgClass} rounded" style="aspect-ratio:1;">
                        ${text}
                    </div>
                </div>
            `;
        }
        
        calendarHTML += '</div>';
        container.innerHTML = calendarHTML;
        
    } catch (error) {
        console.error('Erreur:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

// ============================================
// FONCTIONS PAIEMENTS
// ============================================
function resetPayments() {
    document.getElementById('payment-child-selector').value = '';
    document.getElementById('payment-content').classList.add('hidden');
}

function handlePaymentChildChange(e) {
    const studentId = e.target.value;
    const paymentContent = document.getElementById('payment-content');
    
    if (!studentId) {
        paymentContent.classList.add('hidden');
        return;
    }
    
    paymentContent.classList.remove('hidden');
    loadPaymentStatus(studentId);
    setupPaymentForm(studentId);
}

async function loadPaymentStatus(studentId) {
    const container = document.getElementById('payment-status-container');
    if (!container) return;
    
    container.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Chargement...';
    
    try {
        const paymentsQuery = query(
            collection(db, 'payments'),
            where('studentId', '==', studentId)
        );
        
        const paymentsSnap = await getDocs(paymentsQuery);
        
        if (paymentsSnap.empty) {
            container.innerHTML = '<p class="text-muted">Aucun paiement enregistré</p>';
            return;
        }
        
        const paidMonths = [];
        paymentsSnap.forEach(doc => {
            const payment = doc.data();
            if (payment.status === 'completed') {
                paidMonths.push(payment.month);
            }
        });
        
        container.innerHTML = paidMonths.length > 0
            ? `<p>Mois payés : <strong>${paidMonths.join(', ')}</strong></p>`
            : '<p class="text-muted">Aucun paiement complété</p>';
        
    } catch (error) {
        console.error('Erreur:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

function setupPaymentForm(studentId) {
    const student = childrenList.find(c => c.matricule === studentId);
    if (student) {
        document.getElementById('payment-student-id').value = student.matricule;
        document.getElementById('payment-student-name').value = student.fullName;
        document.getElementById('payment-student-class').value = student.class;
    }
}

async function handlePayment(e) {
    e.preventDefault();
    
    const studentId = document.getElementById('payment-student-id').value;
    const studentName = document.getElementById('payment-student-name').value;
    const month = document.getElementById('payment-month').value;
    const amount = parseInt(document.getElementById('payment-amount').value);
    
    if (!studentId || !studentName || !month || !amount) {
        showToast('Tous les champs sont requis', 'error');
        return;
    }
    
    try {
        const paymentCode = 'PAY' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        await addDoc(collection(db, 'payment_requests'), {
            studentId,
            studentName,
            parentId: currentParent.matricule,
            months: [month],
            amount,
            paymentCode,
            status: 'pending',
            createdAt: serverTimestamp()
        });

        document.getElementById('generated-code').textContent = paymentCode;
        
        const receiptPreview = document.getElementById('receipt-preview');
        receiptPreview.innerHTML = `
            <div class="text-start">
                <h6>CS LA COLOMBE</h6>
                <p class="mb-1"><strong>Code:</strong> ${paymentCode}</p>
                <p class="mb-1"><strong>Élève:</strong> ${studentName}</p>
                <p class="mb-1"><strong>Mois:</strong> ${month}</p>
                <p class="mb-1"><strong>Montant:</strong> ${amount.toLocaleString()} FCFA</p>
                <p class="mb-1"><strong>Date:</strong> ${new Date().toLocaleDateString('fr-FR')}</p>
                <p class="mb-1"><strong>Parent:</strong> ${currentParent.fullName}</p>
            </div>
        `;
        
        const modal = new bootstrap.Modal(document.getElementById('payment-code-modal'));
        modal.show();
        
        document.getElementById('online-payment-form').reset();
        showToast('Demande de paiement enregistrée', 'success');
        
    } catch (error) {
        console.error('Erreur paiement:', error);
        showToast('Erreur lors de la demande', 'error');
    }
}

function downloadReceipt() {
    const receiptContent = document.getElementById('receipt-preview').innerHTML;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Reçu de Paiement</title>
                <style>
                    body { font-family: Arial; padding: 20px; }
                    .receipt { border: 1px solid #ddd; padding: 20px; max-width: 400px; margin: 0 auto; }
                </style>
            </head>
            <body>
                <div class="receipt">
                    ${receiptContent}
                </div>
            </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
}

// ============================================
// FONCTIONS DEVOIRS
// ============================================
function setupHomeworkListeners() {
    document.getElementById('secondary-homework-child-selector').addEventListener('change', (e) => {
        const studentId = e.target.value;
        const content = document.getElementById('secondary-homework-content');
        
        if (!studentId) {
            content.classList.add('hidden');
            return;
        }
        
        content.classList.remove('hidden');
        loadSecondaryHomework(studentId);
    });
    
    document.getElementById('primary-homework-child-selector').addEventListener('change', (e) => {
        const studentId = e.target.value;
        const content = document.getElementById('primary-homework-content');
        
        if (!studentId) {
            content.classList.add('hidden');
            return;
        }
        
        content.classList.remove('hidden');
        loadPrimaryHomework(studentId);
    });
    
    document.getElementById('kindergarten-homework-child-selector').addEventListener('change', (e) => {
        const studentId = e.target.value;
        const content = document.getElementById('kindergarten-homework-content');
        
        if (!studentId) {
            content.classList.add('hidden');
            return;
        }
        
        content.classList.remove('hidden');
        loadKindergartenHomework(studentId);
    });
    
    document.querySelectorAll('#homework-sub-tabs .nav-link').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('#homework-sub-tabs .nav-link').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const target = tab.dataset.tab;
            document.getElementById('pending-homework-container').classList.toggle('hidden', target !== 'pending');
            document.getElementById('submitted-homework-container').classList.toggle('hidden', target !== 'submitted');
            
            const studentId = document.getElementById('secondary-homework-child-selector').value;
            if (studentId) {
                if (target === 'pending') {
                    loadPendingHomework(studentId);
                } else {
                    loadSubmittedHomework(studentId);
                }
            }
        });
    });
}

async function loadSecondaryHomework(studentId) {
    document.getElementById('pending-homework-container').classList.remove('hidden');
    document.getElementById('submitted-homework-container').classList.add('hidden');
    await loadPendingHomework(studentId);
}

async function loadPendingHomework(studentId) {
    const container = document.getElementById('pending-homework-container');
    container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';
    
    try {
        const child = childrenList.find(c => c.matricule === studentId);
        if (!child || child.type !== 'secondary') {
            container.innerHTML = '<p class="text-muted">Enfant non du secondaire</p>';
            return;
        }
        
        const homeworkQuery = query(
            collection(db, 'homework'),
            where('className', '==', child.class),
            where('published', '==', true),
            orderBy('dueDate', 'asc')
        );
        
        const homeworkSnap = await getDocs(homeworkQuery);
        
        if (homeworkSnap.empty) {
            container.innerHTML = '<p class="text-muted">Aucun devoir en cours</p>';
            return;
        }
        
        const now = new Date();
        let html = '';
        
        homeworkSnap.forEach(doc => {
            const hw = doc.data();
            const dueDate = hw.dueDate?.toDate() || new Date();
            
            // Vérifier si déjà soumis
            const hasSubmitted = hw.submissions?.some(s => s.studentMatricule === studentId);
            if (hasSubmitted) return;
            
            const isOverdue = dueDate < now;
            const dueDateStr = dueDate.toLocaleDateString('fr-FR');
            
            const alertClass = isOverdue ? 'danger' : 
                              (dueDate - now) < 2 * 24 * 60 * 60 * 1000 ? 'warning' : 'info';
            
            html += `
                <div class="alert alert-${alertClass} mb-3">
                    <h6 class="alert-heading">${hw.title || 'Devoir'}</h6>
                    <p class="mb-1"><strong>Matière:</strong> ${hw.subject}</p>
                    <p class="mb-1"><strong>À rendre le:</strong> ${dueDateStr}</p>
                    <p class="mb-2">${hw.description || ''}</p>
                    ${hw.fileURL ? `
                        <a href="${hw.fileURL}" target="_blank" class="btn btn-sm btn-primary">
                            <i class="fas fa-download"></i> Télécharger
                        </a>
                    ` : ''}
                </div>
            `;
        });
        
        container.innerHTML = html || '<p class="text-muted">Aucun devoir en cours</p>';
        
    } catch (error) {
        console.error('Erreur:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

async function loadSubmittedHomework(studentId) {
    const container = document.getElementById('submitted-homework-container');
    container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';
    container.classList.remove('hidden');
    
    try {
        const child = childrenList.find(c => c.matricule === studentId);
        if (!child || child.type !== 'secondary') {
            container.innerHTML = '<p class="text-muted">Enfant non du secondaire</p>';
            return;
        }
        
        const homeworkQuery = query(
            collection(db, 'homework'),
            where('className', '==', child.class),
            orderBy('dueDate', 'desc')
        );
        
        const homeworkSnap = await getDocs(homeworkQuery);
        
        let html = '';
        
        homeworkSnap.forEach(doc => {
            const hw = doc.data();
            const submission = hw.submissions?.find(s => s.studentMatricule === studentId);
            
            if (submission) {
                const dueDate = hw.dueDate?.toDate().toLocaleDateString('fr-FR') || '';
                const submittedDate = submission.submittedAt?.toDate().toLocaleDateString('fr-FR') || '';
                const grade = submission.grade ? `${submission.grade}/${submission.maxPoints || 20}` : 'Non noté';
                
                html += `
                    <div class="alert alert-success mb-3">
                        <h6 class="alert-heading">${hw.title || 'Devoir'}</h6>
                        <p class="mb-1"><strong>Matière:</strong> ${hw.subject}</p>
                        <p class="mb-1"><strong>Rendu le:</strong> ${submittedDate}</p>
                        <p class="mb-1"><strong>Note:</strong> ${grade}</p>
                        ${submission.comments ? `<p class="mb-0"><strong>Commentaire:</strong> ${submission.comments}</p>` : ''}
                    </div>
                `;
            }
        });
        
        container.innerHTML = html || '<p class="text-muted">Aucun devoir rendu</p>';
        
    } catch (error) {
        console.error('Erreur:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

async function loadPrimaryHomework(studentId) {
    const container = document.getElementById('primary-homework-container');
    container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';
    
    try {
        const child = childrenList.find(c => c.matricule === studentId);
        if (!child || child.type !== 'primary') {
            container.innerHTML = '<p class="text-muted">Enfant non du primaire</p>';
            return;
        }
        
        const homeworkQuery = query(
            collection(db, 'homework'),
            where('className', '==', child.class),
            where('published', '==', true),
            orderBy('createdAt', 'desc')
        );
        
        const homeworkSnap = await getDocs(homeworkQuery);
        
        if (homeworkSnap.empty) {
            container.innerHTML = '<p class="text-muted">Aucun devoir</p>';
            return;
        }
        
        let html = '';
        homeworkSnap.forEach(doc => {
            const hw = doc.data();
            const dueDate = hw.dueDate?.toDate().toLocaleDateString('fr-FR') || '';
            
            html += `
                <div class="alert alert-info mb-3">
                    <h6 class="alert-heading">${hw.title || 'Devoir'}</h6>
                    <p class="mb-1"><strong>Matière:</strong> ${hw.subject}</p>
                    <p class="mb-1"><strong>À rendre le:</strong> ${dueDate}</p>
                    <p class="mb-2">${hw.description || ''}</p>
                    ${hw.fileURL ? `
                        <a href="${hw.fileURL}" target="_blank" class="btn btn-sm btn-primary">
                            <i class="fas fa-download"></i> Télécharger
                        </a>
                    ` : ''}
                </div>
            `;
        });
        
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Erreur:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

async function loadKindergartenHomework(studentId) {
    const container = document.getElementById('kindergarten-homework-container');
    container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';
    
    try {
        const child = childrenList.find(c => c.matricule === studentId);
        if (!child || child.type !== 'kindergarten') {
            container.innerHTML = '<p class="text-muted">Enfant non de la maternelle</p>';
            return;
        }
        
        const homeworkQuery = query(
            collection(db, 'kindergarten_homework'),
            where('className', '==', child.class),
            where('published', '==', true),
            orderBy('createdAt', 'desc')
        );
        
        const homeworkSnap = await getDocs(homeworkQuery);
        
        if (homeworkSnap.empty) {
            container.innerHTML = '<p class="text-muted">Aucune activité</p>';
            return;
        }
        
        let html = '';
        homeworkSnap.forEach(doc => {
            const hw = doc.data();
            const dueDate = hw.dueDate?.toDate().toLocaleDateString('fr-FR') || '';
            
            html += `
                <div class="alert alert-info mb-3">
                    <h6 class="alert-heading">${hw.title || 'Activité'}</h6>
                    <p class="mb-1"><strong>Activité:</strong> ${hw.subject}</p>
                    <p class="mb-1"><strong>Date:</strong> ${dueDate}</p>
                    <p class="mb-2">${hw.description || ''}</p>
                </div>
            `;
        });
        
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Erreur:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

// ============================================
// FONCTIONS HORAIRE
// ============================================
function resetTimetable() {
    document.getElementById('timetable-child-selector').value = '';
    document.getElementById('timetable-content').classList.add('hidden');
}

function handleTimetableChildChange(e) {
    const studentId = e.target.value;
    const content = document.getElementById('timetable-content');
    
    if (!studentId) {
        content.classList.add('hidden');
        return;
    }
    
    content.classList.remove('hidden');
}

async function loadTimetable() {
    const studentId = document.getElementById('timetable-child-selector').value;
    if (!studentId) {
        showToast('Sélectionnez un enfant', 'error');
        return;
    }
    
    const container = document.getElementById('timetable-container');
    container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';
    
    try {
        const month = document.getElementById('timetable-month').value;
        const week = document.getElementById('timetable-week').value;
        
        const child = childrenList.find(c => c.matricule === studentId);
        if (!child) {
            container.innerHTML = '<p class="text-muted">Enfant non trouvé</p>';
            return;
        }
        
        let timetableQuery = query(
            collection(db, 'student_schedules'),
            where('className', '==', child.class),
            orderBy('publishedAt', 'desc')
        );
        
        if (month) {
            timetableQuery = query(
                collection(db, 'student_schedules'),
                where('className', '==', child.class),
                where('month', '==', month),
                orderBy('publishedAt', 'desc')
            );
        }
        
        if (week) {
            timetableQuery = query(
                collection(db, 'student_schedules'),
                where('className', '==', child.class),
                where('week', '==', week),
                where('month', '==', month),
                orderBy('publishedAt', 'desc')
            );
        }
        
        const timetableSnap = await getDocs(timetableQuery);
        
        if (timetableSnap.empty) {
            container.innerHTML = '<p class="text-muted">Aucun horaire disponible</p>';
            return;
        }
        
        let html = '';
        const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
        
        timetableSnap.forEach(doc => {
            const schedule = doc.data();
            const publishedDate = schedule.publishedAt?.toDate().toLocaleDateString('fr-FR') || '';
            
            html += `
                <div class="card mb-3">
                    <div class="card-header">
                        <strong>Semaine ${schedule.week} - ${schedule.month}</strong>
                        <small class="text-muted ms-2">Publié le ${publishedDate}</small>
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-bordered">
                                <thead class="table-light">
                                    <tr>
                                        <th>Heure</th>
                                        ${days.map(day => `<th>${day}</th>`).join('')}
                                    </tr>
                                </thead>
                                <tbody>
            `;
            
            for (let hour = 1; hour <= 7; hour++) {
                html += `<tr><td>${hour}ère h</td>`;
                days.forEach(day => {
                    const course = schedule.schedule?.find(s => s.hour === hour && s.day === day);
                    html += `<td>${course?.course || '-'}</td>`;
                });
                html += '</tr>';
            }
            
            html += `
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Erreur:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

// ============================================
// FONCTIONS COMMUNIQUÉS
// ============================================
async function loadCommuniques() {
    const container = document.getElementById('communiques-list-container');
    container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';
    
    if (!currentParent || childrenList.length === 0) {
        container.innerHTML = '<p class="text-muted">Aucun communiqué</p>';
        return;
    }
    
    try {
        const relationsQuery = query(
            collection(db, 'parent_communique_relations'),
            where('parentId', '==', currentParent.matricule),
            orderBy('createdAt', 'desc')
        );
        
        const relationsSnap = await getDocs(relationsQuery);
        
        if (relationsSnap.empty) {
            container.innerHTML = '<p class="text-muted">Aucun communiqué</p>';
            return;
        }
        
        const selectedChild = document.getElementById('communique-child-selector').value;
        const selectedType = document.getElementById('communique-type-filter').value;
        
        let html = '';
        
        for (const relationDoc of relationsSnap.docs) {
            const relation = relationDoc.data();
            const communiqueDoc = await getDoc(doc(db, 'parent_communiques', relation.communiqueId));
            
            if (!communiqueDoc.exists()) continue;
            
            const communique = communiqueDoc.data();
            
            // Filtres
            if (selectedChild !== 'all' && !relation.studentIds.includes(selectedChild)) continue;
            if (selectedType !== 'all' && communique.feeType !== selectedType) continue;
            
            const deadline = new Date(communique.deadline);
            const now = new Date();
            const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
            
            let statusClass = '';
            let statusText = '';
            
            if (relation.status === 'paid') {
                statusClass = 'success';
                statusText = 'Payé';
            } else if (daysLeft < 0) {
                statusClass = 'danger';
                statusText = 'En retard';
            } else if (daysLeft <= 3) {
                statusClass = 'warning';
                statusText = 'Urgent';
            } else {
                statusClass = 'info';
                statusText = 'En attente';
            }
            
            html += `
                <div class="card mb-3 border-${statusClass}">
                    <div class="card-body">
                        <div class="d-flex justify-content-between">
                            <h6 class="card-title">${communique.feeType} - ${communique.month}</h6>
                            <span class="badge bg-${statusClass}">${statusText}</span>
                        </div>
                        <p class="card-text small">
                            <strong>Montant:</strong> ${parseFloat(communique.amount).toFixed(2)} $<br>
                            <strong>Date limite:</strong> ${deadline.toLocaleDateString('fr-FR')}<br>
                            <strong>Enfants:</strong> ${relation.studentNames?.join(', ')}
                        </p>
                        <div class="btn-group btn-group-sm">
                            <button class="btn btn-outline-primary" onclick="viewCommunique('${relation.communiqueId}')">
                                Voir
                            </button>
                            ${relation.status !== 'paid' ? `
                                <button class="btn btn-outline-success" onclick="markCommuniquePaid('${relation.communiqueId}')">
                                    Marquer payé
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html || '<p class="text-muted">Aucun communiqué</p>';
        
    } catch (error) {
        console.error('Erreur:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

window.viewCommunique = async (communiqueId) => {
    try {
        const communiqueDoc = await getDoc(doc(db, 'parent_communiques', communiqueId));
        if (!communiqueDoc.exists()) {
            showToast('Communiqué non trouvé', 'error');
            return;
        }
        
        const communique = communiqueDoc.data();
        const deadline = new Date(communique.deadline).toLocaleDateString('fr-FR');
        const today = new Date().toLocaleDateString('fr-FR');
        
        const content = `
            <div class="text-center mb-4">
                <h5>COMMUNIQUE DE PAIEMENT</h5>
                <p>CS la Colombe<br>Lubumbashi, RDC</p>
            </div>
            
            <p class="text-end">Lubumbashi, le ${today}</p>
            
            <p><strong>À l'attention de :</strong> ${currentParent.fullName}</p>
            
            <p><strong>Objet :</strong> Rappel concernant le paiement de ${communique.feeType}</p>
            
            <p>Cher parent,</p>
            
            <p>Nous vous rappelons que la date limite pour le paiement de ${communique.feeType} pour le mois de ${communique.month} est fixée au <strong>${deadline}</strong>.</p>
            
            <p><strong>Montant :</strong> ${parseFloat(communique.amount).toFixed(2)} $</p>
            
            ${communique.message ? `<p>${communique.message}</p>` : ''}
            
            <p>Nous vous remercions de votre collaboration.</p>
            
            <p class="text-end mt-5">La Direction</p>
        `;
        
        document.getElementById('communique-full-content').innerHTML = content;
        
        const modal = new bootstrap.Modal(document.getElementById('communique-full-modal'));
        modal.show();
        
    } catch (error) {
        console.error('Erreur:', error);
        showToast('Erreur lors du chargement', 'error');
    }
};

window.markCommuniquePaid = async (communiqueId) => {
    if (!confirm('Marquer ce communiqué comme payé ?')) return;
    
    try {
        const relationsQuery = query(
            collection(db, 'parent_communique_relations'),
            where('parentId', '==', currentParent.matricule),
            where('communiqueId', '==', communiqueId)
        );
        
        const relationsSnap = await getDocs(relationsQuery);
        
        if (!relationsSnap.empty) {
            const relationDoc = relationsSnap.docs[0];
            await updateDoc(doc(db, 'parent_communique_relations', relationDoc.id), {
                status: 'paid',
                paidAt: serverTimestamp()
            });
        }
        
        showToast('Communiqué marqué comme payé', 'success');
        loadCommuniques();
        
    } catch (error) {
        console.error('Erreur:', error);
        showToast('Erreur lors du marquage', 'error');
    }
};

function printCurrentCommunique() {
    const content = document.getElementById('communique-full-content').innerHTML;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Communiqué</title>
                <style>
                    body { font-family: 'Times New Roman'; padding: 40px; }
                </style>
            </head>
            <body>
                ${content}
            </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
}

// ============================================
// FONCTIONS COTES ET NOTES
// ============================================
function setupGradesListeners() {
    // Secondaire
    document.getElementById('secondary-grades-child-selector').addEventListener('change', (e) => {
        const studentId = e.target.value;
        const content = document.getElementById('secondary-grades-content');
        
        if (!studentId) {
            content.classList.add('hidden');
            return;
        }
        
        content.classList.remove('hidden');
        loadSecondaryGrades(studentId, 'P1');
    });
    
    document.querySelectorAll('#secondary-grades-content .period-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('#secondary-grades-content .period-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const studentId = document.getElementById('secondary-grades-child-selector').value;
            if (studentId) {
                loadSecondaryGrades(studentId, this.dataset.period);
            }
        });
    });
    
    // Primaire
    document.getElementById('primary-grades-child-selector').addEventListener('change', (e) => {
        const studentId = e.target.value;
        const content = document.getElementById('primary-grades-content');
        
        if (!studentId) {
            content.classList.add('hidden');
            return;
        }
        
        content.classList.remove('hidden');
        loadPrimaryGrades(studentId, '1ère P');
    });
    
    document.querySelectorAll('#primary-grades-content .period-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('#primary-grades-content .period-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const studentId = document.getElementById('primary-grades-child-selector').value;
            if (studentId) {
                loadPrimaryGrades(studentId, this.dataset.period);
            }
        });
    });
    
    // Maternelle
    document.getElementById('kindergarten-grades-child-selector').addEventListener('change', (e) => {
        const studentId = e.target.value;
        const content = document.getElementById('kindergarten-grades-content');
        
        if (!studentId) {
            content.classList.add('hidden');
            return;
        }
        
        content.classList.remove('hidden');
        loadKindergartenGrades(studentId);
    });
}

async function loadSecondaryGrades(studentId, period) {
    const container = document.getElementById('secondary-grades-container');
    container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';
    
    try {
        const child = childrenList.find(c => c.matricule === studentId);
        if (!child || child.type !== 'secondary') {
            container.innerHTML = '<p class="text-muted">Enfant non du secondaire</p>';
            return;
        }
        
        if (period === 'TOTAL_S1' || period === 'TOTAL_S2' || period === 'TOTAL_GENERAL') {
            await loadCalculatedGrades(studentId, period, container);
            return;
        }
        
        const gradesQuery = query(
            collection(db, 'parent_grades'),
            where('className', '==', child.class),
            where('period', '==', period)
        );
        
        const gradesSnap = await getDocs(gradesQuery);
        
        if (gradesSnap.empty) {
            container.innerHTML = '<p class="text-muted">Aucune cote disponible</p>';
            return;
        }
        
        let html = '<div class="table-responsive"><table class="table table-bordered"><thead><tr><th>Cours</th><th>CM</th><th>CO</th><th>%</th><th>Date</th></tr></thead><tbody>';
        
        gradesSnap.forEach(doc => {
            const gradeData = doc.data();
            const studentGrade = gradeData.grades?.find(g => g.studentMatricule === studentId);
            
            if (studentGrade) {
                const percentage = ((studentGrade.grade / gradeData.maxPoints) * 100).toFixed(1);
                const date = gradeData.evaluationDate?.toDate().toLocaleDateString('fr-FR') || '';
                
                html += `
                    <tr>
                        <td>${gradeData.subject}</td>
                        <td>${gradeData.maxPoints}</td>
                        <td class="${percentage >= 50 ? 'text-success' : 'text-danger'} fw-bold">${studentGrade.grade}</td>
                        <td>${percentage}%</td>
                        <td>${date}</td>
                    </tr>
                `;
            }
        });
        
        html += '</tbody></table></div>';
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Erreur:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

async function loadCalculatedGrades(studentId, period, container) {
    const child = childrenList.find(c => c.matricule === studentId);
    const periods = period === 'TOTAL_S1' ? ['P1', 'P2', 'EXAM_S1'] :
                    period === 'TOTAL_S2' ? ['P3', 'P4', 'EXAM_S2'] :
                    ['P1', 'P2', 'EXAM_S1', 'P3', 'P4', 'EXAM_S2'];
    
    const coursesData = {};
    let totalCM = 0, totalCO = 0;
    
    for (const p of periods) {
        const gradesQuery = query(
            collection(db, 'parent_grades'),
            where('className', '==', child.class),
            where('period', '==', p)
        );
        
        const gradesSnap = await getDocs(gradesQuery);
        
        gradesSnap.forEach(doc => {
            const gradeData = doc.data();
            const studentGrade = gradeData.grades?.find(g => g.studentMatricule === studentId);
            
            if (studentGrade) {
                if (!coursesData[gradeData.subject]) {
                    coursesData[gradeData.subject] = {
                        totalCM: 0,
                        totalCO: 0,
                        count: 0
                    };
                }
                
                coursesData[gradeData.subject].totalCM += gradeData.maxPoints;
                coursesData[gradeData.subject].totalCO += studentGrade.grade;
                coursesData[gradeData.subject].count++;
            }
        });
    }
    
    if (Object.keys(coursesData).length === 0) {
        container.innerHTML = '<p class="text-muted">Aucune donnée pour le calcul</p>';
        return;
    }
    
    let html = '<div class="table-responsive"><table class="table table-bordered"><thead><tr><th>Cours</th><th>CM Total</th><th>CO Total</th><th>Moyenne</th></tr></thead><tbody>';
    
    Object.entries(coursesData).forEach(([course, data]) => {
        const avg = (data.totalCO / data.totalCM * 100).toFixed(1);
        totalCM += data.totalCM;
        totalCO += data.totalCO;
        
        html += `
            <tr>
                <td>${course}</td>
                <td>${data.totalCM.toFixed(2)}</td>
                <td class="${avg >= 50 ? 'text-success' : 'text-danger'} fw-bold">${data.totalCO.toFixed(2)}</td>
                <td>${avg}%</td>
            </tr>
        `;
    });
    
    const totalAvg = totalCM > 0 ? (totalCO / totalCM * 100).toFixed(1) : 0;
    
    html += `
        <tr class="table-secondary fw-bold">
            <td>TOTAL</td>
            <td>${totalCM.toFixed(2)}</td>
            <td class="${totalAvg >= 50 ? 'text-success' : 'text-danger'}">${totalCO.toFixed(2)}</td>
            <td>${totalAvg}%</td>
        </tr>
    </tbody></table></div>';
    
    html += `<p class="mt-3"><strong>Moyenne générale:</strong> ${totalAvg}%</p>`;
    
    container.innerHTML = html;
}

async function loadPrimaryGrades(studentId, period) {
    const container = document.getElementById('primary-grades-container');
    container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</div>';
    
    try {
        const child = childrenList.find(c => c.matricule === studentId);
        if (!child || child.type !== 'primary') {
            container.innerHTML = '<p class="text-muted">Enfant non du primaire</p>';
            return;
        }
        
        const gradesQuery = query(
            collection(db, 'primary_published_grades'),
            where('studentId', '==', studentId),
            where('period', '==', period)
        );
        
        const gradesSnap = await getDocs(gradesQuery);
        
        if (gradesSnap.empty) {
            container.innerHTML = '<p class="text-muted">Aucune cote disponible</p>';
            return;
        }
        
        let html = '<div class="table-responsive"><table class="table table-bordered"><thead><tr><th>Cours</th><th>CM</th><th>CO</th><th>%</th></tr></thead><tbody>';
        
        gradesSnap.forEach(doc => {
            const gradeData = doc.data();
            gradeData.grades?.forEach(courseGrade => {
                const percentage = ((courseGrade.obtainedGrade / courseGrade.maxGrade) * 100).toFixed(1);
                html += `
                    <tr>
                        <td>${courseGrade.courseName}</td>
                        <td>${courseGrade.maxGrade}</td>
                        <td class="${percentage >= 50 ? 'text-success' : 'text-danger'} fw-bold">${courseGrade.obtainedGrade}</td>
                        <td>${percentage}%</td>
                    </tr>
                `;
            });
        });
        
        html += '</tbody></table></div>';
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Erreur:', error);
        container.innerHTML = '<p class="text-danger">Erreur de chargement</p>';
    }
}

async function loadKindergartenGrades(studentId) {
    const tableBody = document.getElementById('kindergarten-grades-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center"><i class="fas fa-spinner fa-spin"></i></td></tr>';
    
    try {
        const child = childrenList.find(c => c.matricule === studentId);
        if (!child || child.type !== 'kindergarten') {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-muted">Enfant non de la maternelle</td></tr>';
            return;
        }
        
        const gradesQuery = query(
            collection(db, 'kindergarten_grades'),
            where('studentId', '==', studentId),
            orderBy('evaluationDate', 'desc')
        );
        
        const gradesSnap = await getDocs(gradesQuery);
        
        if (gradesSnap.empty) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-muted">Aucune évaluation</td></tr>';
            return;
        }
        
        let html = '';
        const levels = {
            'excellent': 'Excellent',
            'tres_bien': 'Très bien',
            'bien': 'Bien',
            'suffisant': 'Suffisant',
            'insuffisant': 'Insuffisant'
        };
        
        gradesSnap.forEach(doc => {
            const grade = doc.data();
            const date = grade.evaluationDate?.toDate().toLocaleDateString('fr-FR') || '';
            
            html += `
                <tr>
                    <td>${grade.competence || 'Compétence'}</td>
                    <td class="${grade.level === 'excellent' || grade.level === 'tres_bien' ? 'text-success' : grade.level === 'insuffisant' ? 'text-danger' : ''}">
                        ${levels[grade.level] || grade.level}
                    </td>
                    <td>${grade.appreciation || ''}</td>
                    <td>${date}</td>
                    <td>${grade.teacherName || ''}</td>
                </tr>
            `;
        });
        
        tableBody.innerHTML = html;
        
    } catch (error) {
        console.error('Erreur:', error);
        tableBody.innerHTML = '<tr><td colspan="5" class="text-danger">Erreur de chargement</td></tr>';
    }
}

// ============================================
// FONCTIONS AJOUT ENFANT
// ============================================
async function verifyChildMatricule() {
    const matricule = document.getElementById('new-child-matricule').value;
    const resultEl = document.getElementById('child-verification-result');
    
    if (!matricule) {
        resultEl.classList.add('d-none');
        return;
    }
    
    resultEl.classList.remove('d-none');
    resultEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Vérification...';
    
    try {
        let studentData = null;
        let studentType = null;
        
        let studentDoc = await getDoc(doc(db, 'students', matricule));
        if (studentDoc.exists()) {
            studentData = studentDoc.data();
            studentType = 'secondary';
        } else {
            studentDoc = await getDoc(doc(db, 'primary_students', matricule));
            if (studentDoc.exists()) {
                studentData = studentDoc.data();
                studentType = 'primary';
            } else {
                studentDoc = await getDoc(doc(db, 'kindergarten_students', matricule));
                if (studentDoc.exists()) {
                    studentData = studentDoc.data();
                    studentType = 'kindergarten';
                }
            }
        }
        
        if (!studentData) {
            resultEl.className = 'alert alert-danger';
            resultEl.innerHTML = '<i class="fas fa-times-circle me-2"></i>Élève non trouvé';
            return;
        }
        
        if (studentData.parentId) {
            resultEl.className = 'alert alert-warning';
            resultEl.innerHTML = '<i class="fas fa-exclamation-triangle me-2"></i>Cet élève a déjà un parent';
            return;
        }
        
        resultEl.className = 'alert alert-success';
        resultEl.innerHTML = `
            <i class="fas fa-check-circle me-2"></i>
            <strong>${studentData.fullName}</strong> - ${studentData.class}
        `;
        
    } catch (error) {
        console.error('Erreur:', error);
        resultEl.className = 'alert alert-danger';
        resultEl.innerHTML = '<i class="fas fa-times-circle me-2"></i>Erreur de vérification';
    }
}

async function handleAddChild(e) {
    e.preventDefault();
    
    const matricule = document.getElementById('new-child-matricule').value;
    const relation = document.getElementById('child-relation').value;
    
    if (!matricule) {
        showToast('Veuillez entrer un matricule', 'error');
        return;
    }
    
    try {
        let studentData = null;
        let studentType = null;
        let studentRef = null;
        
        let studentDoc = await getDoc(doc(db, 'students', matricule));
        if (studentDoc.exists()) {
            studentData = studentDoc.data();
            studentType = 'secondary';
            studentRef = doc(db, 'students', matricule);
        } else {
            studentDoc = await getDoc(doc(db, 'primary_students', matricule));
            if (studentDoc.exists()) {
                studentData = studentDoc.data();
                studentType = 'primary';
                studentRef = doc(db, 'primary_students', matricule);
            } else {
                studentDoc = await getDoc(doc(db, 'kindergarten_students', matricule));
                if (studentDoc.exists()) {
                    studentData = studentDoc.data();
                    studentType = 'kindergarten';
                    studentRef = doc(db, 'kindergarten_students', matricule);
                }
            }
        }
        
        if (!studentData) {
            showToast('Élève non trouvé', 'error');
            return;
        }
        
        if (studentData.parentId) {
            showToast('Cet élève a déjà un parent', 'error');
            return;
        }
        
        if (childrenList.some(c => c.matricule === matricule)) {
            showToast('Cet enfant est déjà dans votre liste', 'error');
            return;
        }
        
        await updateDoc(studentRef, {
            parentId: currentParent.matricule,
            parentName: currentParent.fullName,
            parentEmail: currentParent.email,
            parentPhone: currentParent.phone,
            parentRelation: relation,
            updatedAt: serverTimestamp()
        });
        
        const updatedChildren = [...currentParent.children, {
            matricule,
            type: studentType
        }];
        
        await updateDoc(doc(db, 'parents', currentParent.matricule), {
            children: updatedChildren,
            updatedAt: serverTimestamp()
        });
        
        currentParent.children = updatedChildren;
        childrenList.push({
            matricule,
            type: studentType,
            ...studentData
        });
        
        // Mettre à jour les sélecteurs
        const displayText = `${studentData.fullName} - ${studentData.class}`;
        
        document.querySelectorAll('#child-selector, #presence-child-selector, #payment-child-selector, #timetable-child-selector, #communique-child-selector').forEach(s => {
            if (s) s.innerHTML += `<option value="${matricule}">${displayText}</option>`;
        });
        
        if (studentType === 'secondary') {
            document.querySelectorAll('#secondary-grades-child-selector, #secondary-homework-child-selector').forEach(s => {
                if (s) s.innerHTML += `<option value="${matricule}">${displayText}</option>`;
            });
        } else if (studentType === 'primary') {
            document.querySelectorAll('#primary-grades-child-selector, #primary-homework-child-selector').forEach(s => {
                if (s) s.innerHTML += `<option value="${matricule}">${displayText}</option>`;
            });
        } else {
            document.querySelectorAll('#kindergarten-grades-child-selector, #kindergarten-homework-child-selector').forEach(s => {
                if (s) s.innerHTML += `<option value="${matricule}">${displayText}</option>`;
            });
        }
        
        updateChildrenPage();
        
        bootstrap.Modal.getInstance(document.getElementById('add-child-modal')).hide();
        document.getElementById('add-child-form').reset();
        document.getElementById('child-verification-result').classList.add('d-none');
        
        showToast('Enfant ajouté avec succès', 'success');
        
    } catch (error) {
        console.error('Erreur:', error);
        showToast('Erreur lors de l\'ajout', 'error');
    }
}

// ============================================
// FONCTIONS UTILITAIRES
// ============================================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `notification-toast ${type}`;
    toast.innerHTML = `
        <div class="toast-header">
            <span class="toast-title">${type === 'success' ? 'Succès' : type === 'error' ? 'Erreur' : type === 'warning' ? 'Attention' : 'Information'}</span>
            <button class="toast-close" onclick="this.closest('.notification-toast').remove()">&times;</button>
        </div>
        <div class="toast-body">${message}</div>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}

function checkForNewData() {
    if (!currentParent || childrenList.length === 0) return;
    console.log('🔍 Vérification des nouvelles données...');
}

// Exposer les fonctions nécessaires globalement
window.showToast = showToast;
window.viewNotification = (id) => {
    const notification = notifications.find(n => n.id === id);
    if (notification) {
        if (!notification.read) {
            notification.read = true;
            saveNotificationsToStorage();
            updateNotificationCount(-1);
            updateAppBadge();
            updateMenuBadges();
        }
        navigateToPage(notification.page || 'dashboard');
    }
};