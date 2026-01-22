export default function handler(req, res) {
	// Expose only public-safe configuration
	const config = {
		paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '',
		walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',
		supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
	};
	res.status(200).json(config);
}
