'use strict';
(() => {
  if (!window.localsoundListener) return;
  document.body.classList.add('listener-native-page');
  const button = document.createElement('button'); button.id = 'changeListenerRoom'; button.type = 'button'; button.className = 'personal-style-button'; button.textContent = 'Changer de salon';
  button.addEventListener('click', () => window.localsoundListener.changeRoom().catch(err => showToast(err.message)));
  document.querySelector('.header-inner').append(button);
})();
