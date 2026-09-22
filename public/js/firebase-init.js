// Firebase Authentication (compat, sin build).
// La apiKey es pública por diseño (solo identifica el proyecto;
// las reglas las aplica Firebase + nuestro backend verifica el token).
var firebaseConfig = {
  apiKey: "AIzaSyDNLzGiLPo7_u6yxi9ifqAnMDOVsxBG_IE",
  authDomain: "proyecto-1.firebaseapp.com",
  projectId: "proyecto-1",
  storageBucket: "proyecto-1.firebasestorage.app",
  messagingSenderId: "362256147155",
  appId: "1:362256147155:web:97bead8396f151a334aa26",
  measurementId: "G-62GJ5DKS3H"
};

firebase.initializeApp(firebaseConfig);
window.fbAuth = firebase.auth();
