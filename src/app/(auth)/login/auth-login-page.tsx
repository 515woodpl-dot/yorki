import LoginForm from './LoginForm'

const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${APP_BASE_PATH}/Yorki.png`} alt="Yorki" className="h-10 w-auto mx-auto mb-6" />
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
