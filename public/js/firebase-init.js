// Firebase Authentication (compat, sin build).
// La apiKey es pública por diseño (solo identifica el proyecto;
// las reglas las aplica Firebase + nuestro backend verifica el token).
var firebaseConfig = {
  apiKey: "AIzaSyCAS9hQFOE5A5dyfdjbYWH4JnLbkDkunZY",
  authDomain: "ubeat-v4.firebaseapp.com",
  projectId: "ubeat-v4",
  storageBucket: "ubeat-v4.firebasestorage.app",
  messagingSenderId: "773180087517",
  appId: "1:773180087517:web:b59f26a85c9a779b7fcf34"
};

firebase.initializeApp(firebaseConfig);
window.fbAuth = firebase.auth();
