(function () {
	'use strict';
	console.log('📦 main.js loaded');

	// Set active payment method button and update global state
	function setActivePaymentMethod(method) {
		try {
			const buttons = document.querySelectorAll('.payment-method-btn');
			buttons.forEach(btn => {
				btn.classList.toggle('active', btn.dataset.method === method);
			});
			window.selectedPaymentMethod = method;
		} catch (e) {
			console.warn('setActivePaymentMethod failed:', e);
		}
	}

	// Lightweight toast helper
	function toast(message, duration = 3000) {
		try {
			const t = document.createElement('div');
			t.textContent = message;
			Object.assign(t.style, {
				position: 'fixed',
				bottom: '24px',
				left: '50%',
				transform: 'translateX(-50%)',
				background: 'rgba(0,0,0,0.75)',
				color: 'white',
				padding: '8px 14px',
				borderRadius: '8px',
				zIndex: 9999,
				fontSize: '14px',
			});
			document.body.appendChild(t);
			setTimeout(() => t.remove(), duration);
		} catch (e) {
			/* ignore */
		}
	}

	// Auto-wire payment method buttons on DOM ready (defensive)
	function wirePaymentButtons() {
		const buttons = document.querySelectorAll('.payment-method-btn');
		if (!buttons || buttons.length === 0) return;
		buttons.forEach(btn => {
			if (btn.__mainWired) return;
			btn.addEventListener('click', () => {
				setActivePaymentMethod(btn.dataset.method);
			});
			btn.__mainWired = true;
		});
	}

	// Expose helpers globally
	window.setActivePaymentMethod = setActivePaymentMethod;
	window.appToast = toast;

	// Wire on DOMContentLoaded and also attempt to wire immediately (in case script is loaded after DOM)
	document.addEventListener('DOMContentLoaded', wirePaymentButtons);
	setTimeout(wirePaymentButtons, 300);

})();
