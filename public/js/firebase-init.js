// Firebase Authentication (compat, sin build).
// La apiKey es pública por diseño (solo identifica el proyecto;
// las reglas las aplica Firebase + nuestro backend verifica el token).
var firebaseConfig = {
  apiKey: "AIzaSyDbG0V_ocYfEgVEEYEqZ-vaYJt4fnQ00vo",
  authDomain: "ubeat-6ac17.firebaseapp.com",
  projectId: "ubeat-6ac17",
  storageBucket: "ubeat-6ac17.firebasestorage.app",
  messagingSenderId: "211846950649",
  appId: "1:211846950649:web:93f67593fe23467bb1fc28"
};

firebase.initializeApp(firebaseConfig);
window.fbAuth = firebase.auth();
