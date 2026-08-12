// Config du projet Firebase (Paramètres du projet > Général > Vos applications
// > app Web, dans la console Firebase). Ce ne sont pas des secrets à protéger :
// Firebase sécurise via les règles Firestore (firestore.rules), pas en cachant
// cette config — elle est de toute façon visible de n'importe quel navigateur.
export const firebaseConfig = {
  apiKey: "REMPLACE_MOI",
  authDomain: "REMPLACE_MOI.firebaseapp.com",
  projectId: "REMPLACE_MOI",
  storageBucket: "REMPLACE_MOI.appspot.com",
  messagingSenderId: "REMPLACE_MOI",
  appId: "REMPLACE_MOI",
};
