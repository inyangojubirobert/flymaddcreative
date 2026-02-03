<!-- Load ethers.js first (required by crypto-payments.js) -->
<script src="https://cdn.ethers.io/lib/ethers-5.7.umd.min.js"></script>

<!-- Load crypto-payments.js BEFORE vote.js -->
<script src="{{ asset('js/crypto-payments.js') }}"></script>

<!-- Load vote.js last -->
<script src="{{ asset('js/vote.js') }}"></script>