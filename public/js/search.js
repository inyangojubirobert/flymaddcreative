// Remove all HTML from this file. Only JavaScript code should be here.

// Search logic for Find Participant page
let foundParticipant = null;
let DEMO_MODE = false;

document.addEventListener('DOMContentLoaded', async function() {
    // Ensure Supabase is initialized
    if (window.initSupabaseFromMeta && window.initSupabaseFromMeta()) {
        DEMO_MODE = false;
    } else {
        console.warn('⚠️ Supabase not initialized, using demo mode');
        DEMO_MODE = true;
    }

    document.getElementById('searchForm').addEventListener('submit', handleSearch);

    const userCodeInput = document.getElementById('userCode');
    userCodeInput.addEventListener('input', function(e) {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    });

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
        userCodeInput.value = code.toUpperCase();
        setTimeout(() => handleSearch(null, code), 500);
    }
});

async function handleSearch(event, providedCode = null) {
    if (event) event.preventDefault();

    const userCode = providedCode || document.getElementById('userCode').value.trim().toUpperCase();

    if (!userCode) {
        showError('Please enter a participant code');
        return;
    }
    if (userCode.length !== 8) {
        showError('Participant code must be exactly 8 characters');
        return;
    }

    const searchButton = document.getElementById('searchButton');
    const buttonText = document.getElementById('searchButtonText');
    const spinner = document.getElementById('searchSpinner');

    searchButton.disabled = true;
    buttonText.textContent = 'Searching...';
    spinner.classList.remove('hidden');

    try {
        if (DEMO_MODE) {
            await simulateSearch(userCode);
        } else {
            await searchParticipantByCode(userCode);
        }
    } catch (error) {
        console.error('Search failed:', error);
        showError(`Search failed: ${error.message}`);
    } finally {
        searchButton.disabled = false;
        buttonText.textContent = '🔍 Find Participant';
        spinner.classList.add('hidden');
    }
}

async function simulateSearch(userCode) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const demoParticipants = {
        'ABC123XY': { id: 1, name: 'John Demo User', username: 'johndemo', email: 'john@example.com', user_code: 'ABC123XY', total_votes: 245, rank: 15 },
        'DEF456ZW': { id: 2, name: 'Sarah Demo User', username: 'sarahdemo', email: 'sarah@example.com', user_code: 'DEF456ZW', total_votes: 189, rank: 23 },
        'GHI789UV': { id: 3, name: 'Mike Demo User', username: 'mikedemo', email: 'mike@example.com', user_code: 'GHI789UV', total_votes: 567, rank: 8 }
    };
    const participant = demoParticipants[userCode];
    if (participant) {
        foundParticipant = participant;
        showParticipantFound();
        console.log('🎭 Demo participant found:', participant);
    } else {
        showError(`No participant found with code "${userCode}". Try ABC123XY, DEF456ZW, or GHI789UV for demo.`);
    }
}

async function searchParticipantByCode(userCode) {
    // Use backend API for search
    try {
        const response = await fetch(`/api/onedream/participants/code/${userCode}`);
        if (!response.ok) throw new Error('Participant not found');
        const data = await response.json();
        foundParticipant = data.participant;
        if (!foundParticipant) throw new Error('Participant not found');
        showParticipantFound();
    } catch (error) {
        showError(error.message);
    }
}

function showParticipantFound() {
    if (!foundParticipant) return;
    document.getElementById('errorState').classList.add('hidden');
    document.getElementById('searchResults').classList.remove('hidden');
    document.getElementById('foundParticipantName').textContent = foundParticipant.name;
    document.getElementById('foundParticipantUsername').textContent = foundParticipant.username;
    document.getElementById('foundParticipantEmail').textContent = foundParticipant.email;
    document.getElementById('foundParticipantVotes').textContent = foundParticipant.total_votes.toLocaleString();
    document.getElementById('foundParticipantRank').textContent = `#${foundParticipant.rank}`;
    const initials = foundParticipant.name.split(' ').map(n => n.charAt(0)).join('').toUpperCase().slice(0, 2);
    document.getElementById('foundParticipantInitials').textContent = initials;
    document.getElementById('voteForParticipant').onclick = function() {
        window.location.href = `vote.html?username=${foundParticipant.username}`;
    };
    document.getElementById('searchResults').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showError(message) {
    document.getElementById('searchResults').classList.add('hidden');
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorState').classList.remove('hidden');
    document.getElementById('errorState').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function searchAgain() {
    document.getElementById('userCode').value = '';
    document.getElementById('userCode').focus();
    document.getElementById('searchResults').classList.add('hidden');
    document.getElementById('errorState').classList.add('hidden');
    foundParticipant = null;
    document.getElementById('searchForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateURL(userCode) {
    const url = new URL(window.location);
    if (userCode) {
        url.searchParams.set('code', userCode);
    } else {
        url.searchParams.delete('code');
    }
    window.history.replaceState(null, '', url.toString());
}

console.log('🔍 One Dream Initiative Search Page loaded');
console.log('🔐 Using secure configuration from environment variables');