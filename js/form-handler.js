document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('collaboration-form');
    
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Get form data
        const formData = {
            name: document.getElementById('name').value,
            email: document.getElementById('email').value,
            role: document.getElementById('role').value,
            collaboration_type: document.getElementById('collaboration_type').value,
            message: document.getElementById('message').value,
            portfolio: document.getElementById('portfolio').value,
            submitted_at: new Date().toISOString()
        };

        try {
            // 1. Save to Supabase
            const { data, error } = await supabase
                .from('collaboration_submissions')
                .insert([formData]);

            if (error) throw error;

            // 2. Send email notification (using Supabase Edge Function)
            const emailResponse = await fetch('YOUR_EDGE_FUNCTION_URL', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to: 'your-email@example.com', // Your email
                    subject: 'New Collaboration Request',
                    text: `New submission from ${formData.name} (${formData.email}):\n\n` +
                          `Role: ${formData.role}\n` +
                          `Collaboration Type: ${formData.collaboration_type}\n\n` +
                          `Message: ${formData.message}\n\n` +
                          `Portfolio: ${formData.portfolio}`
                })
            });

            if (!emailResponse.ok) throw new Error('Failed to send email');

            // Success message
            form.innerHTML = `
                <div class="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                    <div class="text-green-600 mb-3">
                        <svg class="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h3 class="text-lg font-medium text-gray-900 mb-1">Thank you!</h3>
                    <p class="text-gray-600">Your submission has been received. We'll get back to you soon!</p>
                </div>
            `;
        } catch (error) {
            console.error('Error:', error);
            alert('There was an error submitting your form. Please try again.');
        }
    });
});
