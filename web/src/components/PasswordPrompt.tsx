import { Eye, EyeOff, Lock } from 'lucide-solid';
import { createSignal } from 'solid-js';
import { api } from '~/api/client';
import { setPasswordRequired } from '~/store/share';

interface Props {
  onSuccess: () => void;
}

export default function PasswordPrompt(props: Props) {
  const [password, setPassword] = createSignal('');
  const [showPassword, setShowPassword] = createSignal(false);
  const [isValidating, setIsValidating] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal('');

  async function handleSubmit(e: Event) {
    e.preventDefault();

    if (!password().trim()) {
      setErrorMessage('Please enter a password');
      return;
    }

    setIsValidating(true);
    setErrorMessage('');

    try {
      await api.validatePassword(password());
      setPasswordRequired(false);
      props.onSuccess();
    } catch (err) {
      if (err instanceof Error && err.message.includes('401')) {
        setErrorMessage('Invalid password');
      } else {
        setErrorMessage('An error occurred. Please try again.');
      }
    } finally {
      setIsValidating(false);
    }
  }

  return (
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-md animate-fadeIn">
        <div class="glass-card rounded-3xl p-8">
          {/* Icon */}
          <div class="text-center mb-8">
            <div class="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-slate/20 to-icy-aqua/20 flex items-center justify-center">
              <Lock class="w-10 h-10 text-light-blue" />
            </div>
            <h1 class="text-2xl font-bold text-white">Password Required</h1>
            <p class="text-white/50 mt-2">This album is protected</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div class="mb-6">
              <label for="password" class="block text-sm font-medium text-white/60 mb-2">
                Password
              </label>
              <div class="relative">
                <input
                  type={showPassword() ? 'text' : 'password'}
                  id="password"
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  placeholder="Enter password"
                  class="w-full px-4 py-3.5 pr-12 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-icy-aqua focus:ring-1 focus:ring-icy-aqua text-white placeholder-white/30 transition-all"
                  disabled={isValidating()}
                />
                <button
                  type="button"
                  class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/60 transition-colors"
                  onClick={() => setShowPassword(!showPassword())}
                >
                  {showPassword() ? <EyeOff class="w-5 h-5" /> : <Eye class="w-5 h-5" />}
                </button>
              </div>
            </div>

            {errorMessage() && (
              <div class="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {errorMessage()}
              </div>
            )}

            <button
              type="submit"
              class="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-slate to-light-blue hover:from-blue-slate/90 hover:to-light-blue/90 text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-slate/25 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isValidating()}
            >
              {isValidating() ? (
                <span class="inline-flex items-center gap-2">
                  <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Checking...
                </span>
              ) : (
                'Unlock Album'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
