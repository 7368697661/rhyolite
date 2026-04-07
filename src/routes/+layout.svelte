<script>
    import '../app.css';
    let { children } = $props();
</script>

<svelte:head>
    <title>Rhyolite//</title>
</svelte:head>

<div class="min-h-screen bg-black font-sans antialiased text-gray-100 dark">
    {@render children()}
</div>
