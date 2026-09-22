// Firebase Authentication (compat, sin build).
// La apiKey es pública por diseño (solo identifica el proyecto;
// las reglas las aplica Firebase + nuestro backend verifica el token).
var firebaseConfig = {
  apiKey: "AIzaSyBaqmO-S7XmvXxmlKY_8rc-NDJeJbMYMXg",
  authDomain: "ubeat-genai.firebaseapp.com",
  projectId: "ubeat-genai",
  storageBucket: "ubeat-genai.firebasestorage.app",
  messagingSenderId: "1037066735481",
  appId: "1:1037066735481:web:497c9f26f4c2635b1069a8"
};

firebase.initializeApp(firebaseConfig);
window.fbAuth = firebase.auth();
