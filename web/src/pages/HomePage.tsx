import { Images, Share2, Shield, Upload } from 'lucide-solid';
import { onCleanup, onMount } from 'solid-js';
import { captureEvent, registerPage, unregisterPage } from '~/analytics';

export default function HomePage() {
  onMount(() => {
    registerPage('home');
    captureEvent('home_viewed');
  });

  onCleanup(() => {
    unregisterPage();
  });

  return (
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="text-center max-w-lg animate-fadeIn">
        {/* Logo */}
        <div class="w-24 h-24 mx-auto mb-8 rounded-3xl bg-gradient-to-br from-blue-slate to-icy-aqua flex items-center justify-center shadow-2xl glow-aqua">
          <Images class="w-12 h-12 text-white" />
        </div>

        {/* Title */}
        <h1 class="text-4xl font-bold text-white mb-3 tracking-tight">
          Immich Public Proxy
        </h1>
        <p class="text-lg text-white/50 mb-12">
          Share your photos securely with anyone
        </p>

        {/* Features */}
        <div class="grid grid-cols-3 gap-4 max-w-md mx-auto">
          <div class="glass-card p-4 rounded-2xl">
            <div class="w-10 h-10 mx-auto mb-3 rounded-xl bg-icy-aqua/20 flex items-center justify-center glow-aqua">
              <Share2 class="w-5 h-5 text-icy-aqua" />
            </div>
            <p class="text-sm text-white/60">Easy Sharing</p>
          </div>
          <div class="glass-card p-4 rounded-2xl">
            <div class="w-10 h-10 mx-auto mb-3 rounded-xl bg-light-blue/20 flex items-center justify-center">
              <Shield class="w-5 h-5 text-light-blue" />
            </div>
            <p class="text-sm text-white/60">Secure Access</p>
          </div>
          <div class="glass-card p-4 rounded-2xl">
            <div class="w-10 h-10 mx-auto mb-3 rounded-xl bg-powder-blush/20 flex items-center justify-center glow-blush">
              <Upload class="w-5 h-5 text-powder-blush" />
            </div>
            <p class="text-sm text-white/60">Upload Support</p>
          </div>
        </div>

        {/* Footer */}
        <p class="mt-12 text-sm text-white/30">
          Access shared albums via their unique links
        </p>
      </div>
    </div>
  );
}
