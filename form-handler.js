document.getElementById('collaborationForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitButton = e.target.querySelector('button[type="submit"]');
    const originalButtonText = submitButton.textContent;

    try {
        // Disable button and show loading state
        submitButton.disabled = true;
        submitButton.innerHTML = 'Submitting...';

        const formData = {
            name: document.getElementById('name').value,
            email: document.getElementById('email').value,
            role: document.getElementById('role').value,
            collaboration_type: document.getElementById('collaboration_type').value,
            message: document.getElementById('message').value,
            portfolio: document.getElementById('portfolio').value || null,
            status: 'pending'
        };

        // Insert into Supabase
        const { data, error } = await supabase
            .from('collaboration_submissions')
            .insert([formData])
            .select();

        if (error) throw error;

        // Show success message
        alert('Thank you for your submission! We will get back to you soon.');
        e.target.reset();

    } catch (error) {
        console.error('Error submitting form:', error);
        alert('There was an error submitting your form. Please try again.');
    } finally {
        // Reset button state
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
    }
});