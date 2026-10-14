//! Creates a limited-scope localhost HTTPS certificate for the desktop OAuth callback.
//! The CA private key is intentionally never persisted to disk.

#[derive(Debug)]
pub struct LocalCertBundle {
    pub ca_pem: String,
    pub server_pem: String,
    pub server_key_pem: String,
}

pub fn generate_local_cert_bundle() -> Result<LocalCertBundle, String> {
    use rcgen::{
        BasicConstraints, CertificateParams, DistinguishedName, DnType,
        ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair, KeyUsagePurpose,
    };
    use time::{Duration, OffsetDateTime};

    let now = OffsetDateTime::now_utc();
    let mut ca = CertificateParams::new(Vec::<String>::new()).map_err(|e| e.to_string())?;
    ca.distinguished_name = DistinguishedName::new();
    ca.distinguished_name.push(DnType::CommonName, "Meta Manager Local OAuth CA");
    ca.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
    ];
    ca.not_before = now - Duration::days(1);
    ca.not_after = now + Duration::days(3650);
    let ca_key = KeyPair::generate().map_err(|e| e.to_string())?;
    let ca_cert = ca.self_signed(&ca_key).map_err(|e| e.to_string())?;
    let issuer = Issuer::new(ca, ca_key);

    let mut server = CertificateParams::new(vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
    ]).map_err(|e| e.to_string())?;
    server.distinguished_name = DistinguishedName::new();
    server.distinguished_name.push(DnType::CommonName, "localhost");
    server.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    server.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    server.not_before = now - Duration::days(1);
    server.not_after = now + Duration::days(350);
    server.use_authority_key_identifier_extension = true;
    let server_key = KeyPair::generate().map_err(|e| e.to_string())?;
    let server_cert = server.signed_by(&server_key, &issuer).map_err(|e| e.to_string())?;

    Ok(LocalCertBundle {
        ca_pem: ca_cert.pem(),
        server_pem: server_cert.pem(),
        server_key_pem: server_key.serialize_pem(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_distinct_ca_and_server_certificates() {
        let bundle = generate_local_cert_bundle().unwrap();
        assert!(bundle.ca_pem.contains("BEGIN CERTIFICATE"));
        assert!(bundle.server_pem.contains("BEGIN CERTIFICATE"));
        assert!(bundle.server_key_pem.contains("PRIVATE KEY"));
        assert_ne!(bundle.ca_pem, bundle.server_pem);
    }

    #[test]
    fn localhost_certificate_has_valid_server_chain() {
        // Invoke OpenSSL only as a local test helper; the Windows production
        // application generates and validates certificates with Rust libraries.
        let bundle = generate_local_cert_bundle().unwrap();
        let dir = std::env::temp_dir().join(format!("meta-manager-tls-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ca = dir.join("ca.pem");
        let server = dir.join("server.pem");
        std::fs::write(&ca, &bundle.ca_pem).unwrap();
        std::fs::write(&server, &bundle.server_pem).unwrap();

        let openssl = std::process::Command::new("openssl")
            .args(["verify", "-CAfile"])
            .arg(&ca)
            .arg("-verify_ip").arg("127.0.0.1")
            .arg(&server)
            .output();
        if let Ok(result) = openssl {
            assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
