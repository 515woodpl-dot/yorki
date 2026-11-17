import LoginForm from './LoginForm'
import BrandLogo from '@/components/brand/BrandLogo'


export default function LoginPage() {
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <BrandLogo className="h-10 mx-auto mb-6" />
          <h1 className="text-xl font-semibold text-foreground">Sign in to Yorki</h1>
          <p className="text-sm text-muted-foreground mt-1">Enter your credentials to continue</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <LoginForm />
        </div>
      </div>
    </div>
  )
}
