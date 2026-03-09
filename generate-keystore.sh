#!/bin/bash
# Android Keystore Generation Script
# This generates a production keystore for signing Android apps

echo ""
echo "=== Android Keystore Generator ==="
echo ""

# Keystore configuration
KEYSTORE_NAME="gyw-release.keystore"
KEY_ALIAS="gyw-release-key"
VALIDITY_YEARS=25

# Check if keytool exists
if ! command -v keytool &> /dev/null; then
    echo "❌ keytool not found! Make sure Java JDK is installed."
    echo "   Install Java JDK from: https://adoptium.net/"
    exit 1
fi

# Check if keystore already exists
if [ -f "$KEYSTORE_NAME" ]; then
    echo "⚠️  Keystore file already exists: $KEYSTORE_NAME"
    read -p "Overwrite? (y/N): " overwrite
    if [ "$overwrite" != "y" ] && [ "$overwrite" != "Y" ]; then
        echo "Cancelled."
        exit 0
    fi
    rm -f "$KEYSTORE_NAME"
fi

# Get keystore password
echo "Enter a password for the keystore (min 6 characters):"
read -s KEYSTORE_PASSWORD
echo ""

if [ ${#KEYSTORE_PASSWORD} -lt 6 ]; then
    echo "❌ Password must be at least 6 characters!"
    exit 1
fi

# Get key password
echo "Enter a password for the key (press Enter to use same as keystore):"
read -s KEY_PASSWORD
echo ""

if [ -z "$KEY_PASSWORD" ]; then
    KEY_PASSWORD="$KEYSTORE_PASSWORD"
fi

# Get organization details
echo ""
echo "Enter your organization details (for certificate):"
read -p "Organization Name (CN) [GYW]: " CN
CN=${CN:-GYW}

read -p "Organizational Unit (OU) [Mobile Development]: " OU
OU=${OU:-Mobile Development}

read -p "Organization (O) [GYW]: " O
O=${O:-GYW}

read -p "City/Locality (L) []: " L
read -p "State/Province (ST) []: " ST
read -p "Country Code (C) [US]: " C
C=${C:-US}

# Build distinguished name
DNAME="CN=$CN, OU=$OU, O=$O"
[ -n "$L" ] && DNAME="$DNAME, L=$L"
[ -n "$ST" ] && DNAME="$DNAME, ST=$ST"
DNAME="$DNAME, C=$C"

echo ""
echo "Generating keystore..."

# Generate keystore
keytool -genkeypair \
    -v \
    -storetype PKCS12 \
    -keystore "$KEYSTORE_NAME" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity $((VALIDITY_YEARS * 365)) \
    -storepass "$KEYSTORE_PASSWORD" \
    -keypass "$KEY_PASSWORD" \
    -dname "$DNAME"

if [ $? -eq 0 ] && [ -f "$KEYSTORE_NAME" ]; then
    echo "✅ Keystore generated successfully: $KEYSTORE_NAME"
    echo ""
    
    # Extract SHA-1 fingerprint
    echo "Extracting SHA-1 fingerprint..."
    SHA1_OUTPUT=$(keytool -list -v -keystore "$KEYSTORE_NAME" -alias "$KEY_ALIAS" -storepass "$KEYSTORE_PASSWORD" 2>&1)
    SHA1=$(echo "$SHA1_OUTPUT" | grep -i "SHA1:" | sed 's/.*SHA1: //' | tr -d ' ')
    
    if [ -n "$SHA1" ]; then
        echo ""
        echo "📋 SHA-1 Fingerprint:"
        echo "$SHA1"
        echo ""
        echo "⚠️  IMPORTANT: Add this SHA-1 to Firebase Console!"
        echo "   1. Go to Firebase Console → Project Settings → Your apps → Android"
        echo "   2. Click 'Add fingerprint'"
        echo "   3. Paste: $SHA1"
        echo "   4. Download NEW google-services.json"
        echo ""
    fi
    
    # Extract SHA-256 fingerprint
    SHA256=$(echo "$SHA1_OUTPUT" | grep -i "SHA256:" | sed 's/.*SHA256: //' | tr -d ' ')
    if [ -n "$SHA256" ]; then
        echo "📋 SHA-256 Fingerprint:"
        echo "$SHA256"
        echo ""
    fi
    
    echo "=== Keystore Information ==="
    echo "Keystore file: $KEYSTORE_NAME"
    echo "Alias: $KEY_ALIAS"
    echo "Validity: $VALIDITY_YEARS years"
    echo ""
    echo "⚠️  SECURITY WARNING:"
    echo "   - Keep this keystore file safe and secure!"
    echo "   - Do NOT commit it to version control (already in .gitignore)"
    echo "   - Store passwords securely (consider using a password manager)"
    echo "   - If lost, you cannot update your app on Play Store!"
    echo ""
    echo "=== Next Steps ==="
    echo "1. Add SHA-1 fingerprint to Firebase Console"
    echo "2. Download updated google-services.json"
    echo "3. Configure EAS Build with keystore:"
    echo "   eas credentials"
    echo "   (Select Android → Keystore → Upload existing)"
    echo ""
    
else
    echo "❌ Failed to generate keystore!"
    exit 1
fi
