# Helper script to switch backend environment settings between local, remote, and ngrok modes.
# Run this from the repo root:
#   .\scripts\switch-env.ps1 -Profile local
#   .\scripts\switch-env.ps1 -Profile remote -MongoUri 'mongodb://server:27017/' -AllowedOrigins 'https://app.example.com' -Environment production -ForceHttps
#   .\scripts\switch-env.ps1 -Profile ngrok -NgrokUrl 'https://xxxxxx.ngrok.app'

param(
    [ValidateSet('local','remote','ngrok')]
    [string]$Profile = 'local',

    [string]$MongoUri = 'mongodb://localhost:27017/',
    [string]$DatabaseName = 'IIOT_SCADA',
    [string]$SecretKey = 'Online_Monitoring_System_Key_007',
    [string]$AdminSecret = 'ADMIN_SECRET_VAULT007',
    [string]$ApiKey,
    [string]$AllowedOrigins,
    [string]$Environment,
    [switch]$ForceHttps,
    [switch]$NoForceHttps,
    [switch]$UseNgrok,
    [switch]$NonInteractive,
    [string]$NgrokUrl
)

function Get-RepoRoot {
    return Split-Path -Parent $MyInvocation.MyCommand.Definition
}

function Read-EnvFile($path) {
    $result = @{}
    if (-Not (Test-Path $path)) {
        return $result
    }
    Get-Content $path | ForEach-Object {
        if ($_ -match '^[ \t]*#') { return }
        if ($_ -match '^[ \t]*$') { return }
        $parts = $_ -split '=', 2
        if ($parts.Count -eq 2) {
            $key = $parts[0].Trim()
            $value = $parts[1].Trim()
            $result[$key] = $value
        }
    }
    return $result
}

function Prompt-ForValue($prompt, $default, $nonInteractive) {
    if ($nonInteractive) {
        if ($default) {
            return $default
        }
        throw "Non-interactive mode requires a value for: $prompt"
    }

    if ($default) {
        $value = Read-Host "$prompt [$default]"
        if ($value) { return $value }
        return $default
    }
    return Read-Host $prompt
}

function Validate-Uri($value, $schemes = @('http','https','mongodb','mqtt','mqtts','ws','wss','tcp')) {
    if (-not $value) { return $false }
    try {
        $uri = [System.Uri]$value
        return $schemes -contains $uri.Scheme
    } catch {
        return $false
    }
}

function Resolve-Value($name, $value, $existingEnv, $default) {
    if ($value) { return $value }
    if ($existingEnv.ContainsKey($name)) { return $existingEnv[$name] }
    return $default
}

$repoRoot = Get-RepoRoot
$backendDir = Join-Path $repoRoot 'backend'
$envPath = Join-Path $backendDir '.env'
$existingEnv = Read-EnvFile $envPath

$SecretKey = Resolve-Value 'SECRET_KEY' $SecretKey $existingEnv 'Online_Monitoring_System_Key_007'
$AdminSecret = Resolve-Value 'ADMIN_SECRET' $AdminSecret $existingEnv ''
$ApiKey = Resolve-Value 'API_KEY' $ApiKey $existingEnv ''
$DatabaseName = Resolve-Value 'DATABASE_NAME' $DatabaseName $existingEnv 'IIOT_SCADA'

switch ($Profile) {
    'local' {
        $MongoUri = Resolve-Value 'MONGO_URI' $MongoUri $existingEnv 'mongodb://localhost:27017/'
        $AllowedOrigins = Resolve-Value 'ALLOWED_ORIGINS' $AllowedOrigins $existingEnv 'http://localhost:5000'
        $Environment = Resolve-Value 'ENVIRONMENT' $Environment $existingEnv 'development'
        $ForceHttpsValue = 'false'
    }
    'remote' {
        $MongoUri = Resolve-Value 'MONGO_URI' $MongoUri $existingEnv ''
        if (-Not $MongoUri) {
            $MongoUri = Prompt-ForValue 'Enter remote MongoDB URI (example: mongodb://db.example.com:27017/)' '' $NonInteractive
        }
        if (-Not $MongoUri) { throw 'MongoUri is required for remote mode.' }
        if (-Not (Validate-Uri $MongoUri @('mongodb','mongodb+srv'))) {
            throw "Remote MongoDB URI is not valid: $MongoUri"
        }

        if (-Not $AllowedOrigins) {
            $AllowedOrigins = Prompt-ForValue 'Enter ALLOWED_ORIGINS for browser access (comma-separated)' ($existingEnv['ALLOWED_ORIGINS'] -or '') $NonInteractive
        }
        if (-Not $AllowedOrigins) { throw 'AllowedOrigins is required for remote mode.' }

        $Environment = Resolve-Value 'ENVIRONMENT' $Environment $existingEnv 'production'
        if ($NoForceHttps) {
            $ForceHttpsValue = 'false'
        } else {
            $ForceHttpsValue = 'true'
        }
    }
    'ngrok' {
        $MongoUri = Resolve-Value 'MONGO_URI' $MongoUri $existingEnv 'mongodb://localhost:27017/'
        if ($UseNgrok) {
            if (Get-Command ngrok -ErrorAction SilentlyContinue) {
                Write-Host 'Starting ngrok tunnel for local backend on port 5000...'
                Start-Process ngrok -ArgumentList 'http 5000' -NoNewWindow:$false
                Start-Sleep -Seconds 2
            } else {
                Write-Warning 'ngrok is not installed or not in PATH. Please install ngrok or provide a tunnel URL manually via -NgrokUrl.'
            }
        }

        if (-Not $NgrokUrl) {
            $NgrokUrl = Prompt-ForValue 'Enter ngrok URL (example: https://xxxxx.ngrok.app)' ($existingEnv['ALLOWED_ORIGINS'] -or '') $NonInteractive
        }
        if (-Not $NgrokUrl) { throw 'NgrokUrl or AllowedOrigins is required for ngrok mode.' }
        if (-Not (Validate-Uri $NgrokUrl @('http','https'))) {
            throw "Ngrok URL is not valid: $NgrokUrl"
        }
        $AllowedOrigins = $NgrokUrl
        $Environment = Resolve-Value 'ENVIRONMENT' $Environment $existingEnv 'development'
        $ForceHttpsValue = 'true'
    }
    Default {
        throw "Unsupported profile: $Profile"
    }
}

if ($ForceHttps) { $ForceHttpsValue = 'true' }
if ($NoForceHttps) { $ForceHttpsValue = 'false' }

if (-Not $AdminSecret) {
    $AdminSecret = Prompt-ForValue 'Enter ADMIN_SECRET (required for creating master accounts)' ($existingEnv['ADMIN_SECRET'] -or '')
}

$envLines = @(
    '# Auto-generated backend environment file. Edit with care.'
    "MONGO_URI=$MongoUri"
    "DATABASE_NAME=$DatabaseName"
    "SECRET_KEY=$SecretKey"
    "ADMIN_SECRET=$AdminSecret"
    "API_KEY=$ApiKey"
    "ALLOWED_ORIGINS=$AllowedOrigins"
    'MAX_LOGIN_ATTEMPTS=5'
    'LOGIN_LOCKOUT_MINUTES=15'
    'API_TOKEN_EXPIRATION_HOURS=72'
    "ENVIRONMENT=$Environment"
    "FORCE_HTTPS=$ForceHttpsValue"
)

Set-Content -Path $envPath -Value $envLines -Encoding UTF8
Write-Host "Wrote backend environment file: $envPath"
Write-Host "Profile: $Profile"
Write-Host "MONGO_URI: $MongoUri"
Write-Host "ALLOWED_ORIGINS: $AllowedOrigins"
Write-Host "ENVIRONMENT: $Environment"
Write-Host "FORCE_HTTPS: $ForceHttpsValue"
Write-Host 'Note: You can run the Flask backend once this file is created.'
