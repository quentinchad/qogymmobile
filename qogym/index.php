<!DOCTYPE html>
<html lang="fr">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">


    <title>Quentin Chirat — Développeur Web & Chef de Projet Informatique · Annonay / Saint-Étienne</title>
    <meta name="description" content="Portfolio de Quentin Chirat, développeur web et chef de projet informatique basé à Annonay et Saint-Étienne. Spécialisé en React, Node.js, IA et gestion de projet Agile.">


    <meta property="og:title" content="Quentin Chirat — Développeur Web & Chef de Projet">
    <meta property="og:description" content="Portfolio de Quentin Chirat, développeur web spécialisé en React, Node.js et IA, basé en Auvergne-Rhône-Alpes.">
    <meta property="og:url" content="https://www.quentin-chirat.com/">
    <meta property="og:type" content="website">


    <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Person",
            "name": "Quentin Chirat",
            "jobTitle": "Développeur Web & Chef de Projet Informatique",
            "url": "https://www.quentin-chirat.com",
            "address": {
                "@type": "PostalAddress",
                "addressLocality": "Saint-Étienne",
                "addressRegion": "Auvergne-Rhône-Alpes",
                "addressCountry": "FR"
            },
            "knowsAbout": ["Développement Web", "Intelligence Artificielle", "Gestion de Projet"]
        }
    </script>

    <link rel="stylesheet" href="styles.css">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
</head>

<body>

    <nav class="navbar">
        <div class="nav-container">
            <div class="nav-logo">
                <a href="index">Portfolio</a>
            </div>
            <ul class="nav-menu">
                <li class="nav-item">
                    <a href="index" class="nav-link">Accueil</a>
                </li>
                <li class="nav-item">
                    <a href="pages/realisations" class="nav-link">Réalisations</a>
                </li>
                <li class="nav-item">
                    <a href="#competences" class="nav-link">Compétences</a>
                </li>
                <li class="nav-item">
                    <a href="#parcours" class="nav-link">Parcours</a>
                </li>
                <li class="nav-item">
                    <a href="services" class="nav-link">Services</a>
                </li>
                <li class="nav-item dropdown">
                    <a href="#" class="nav-link dropdown-toggle">Collaborateurs <i class="fas fa-chevron-down"></i></a>
                    <ul class="dropdown-menu">
                        <li><a href="https://loan-thomas.com/portfolio/" target="_blank">Loan Thomas</a></li>
                    </ul>
                </li>
                <li class="nav-item">
                    <a href="https://qojimcinema.vercel.app/" target="_blank" class="nav-link">Revue Cinéma</a>
                </li>
            </ul>
            <div class="hamburger">
                <span class="bar"></span>
                <span class="bar"></span>
                <span class="bar"></span>
            </div>
        </div>
    </nav>

    <main>
        <!-- Section Hero -->
        <section class="hero">
            <div class="container">
                <div class="hero-content">
                    <h1>Quentin Chirat</h1>
                    <h2 class="titreMetier">Développement et Gestion de Projets Informatiques</h2>
                    <div class="hero-buttons">
                        <a href="#contact" class="btn btn-primary">Me Contacter</a>
                        <a href="pages/realisations.html" class="btn btn-secondary">Voir mes Réalisations</a>
                    </div>
                </div>
                <div class="hero-image">
                    <div class="profile-placeholder">
                        <img class="profile-placeholder" src="img/logoQojimCom.png">
                    </div>
                </div>
            </div>
        </section>

        <!-- Section Compétences -->
        <section id="competences" class="competences">
            <div class="container">
                <h2>Mes Compétences</h2>
                <div class="competences-grid">
                    <div class="competence-card">
                        <div class="competence-icon">
                            <i class="fas fa-code"></i>
                        </div>
                        <h3>Développement Web</h3>
                        <div class="skills">
                            <span class="skill">HTML/CSS</span>
                            <span class="skill">Php</span>
                            <span class="skill">JavaScript</span>
                            <span class="skill">React</span>
                            <span class="skill">Node.js</span>
                        </div>
                    </div>

                    <div class="competence-card">
                        <div class="competence-icon">
                            <i class="fas fa-robot"></i>
                        </div>
                        <h3>Intelligence Artificielle</h3>
                        <div class="skills">
                            <span class="skill">Chatbots</span>
                            <span class="skill">Machine Learning</span>
                            <span class="skill">API Integration</span>
                        </div>
                    </div>

                    <div class="competence-card">
                        <div class="competence-icon">
                            <i class="fas fa-laptop-code"></i>
                        </div>
                        <h3>Développement logiciel</h3>
                        <div class="skills">
                            <span class="skill">C#</span>
                            <span class="skill">Python</span>
                            <span class="skill">Java</span>
                        </div>
                    </div>

                    <div class="competence-card">
                        <div class="competence-icon">
                            <i class="fas fa-project-diagram"></i>
                        </div>
                        <h3>Gestion de Projet</h3>
                        <div class="skills">
                            <span class="skill">Agile/Scrum</span>
                            <span class="skill">Azure Devops</span>
                            <span class="skill">Trello</span>
                            <span class="skill">Github</span>
                        </div>
                    </div>

                    <div class="competence-card">
                        <div class="competence-icon">
                            <i class="fas fa-wrench"></i>
                        </div>
                        <h3>Outils</h3>
                        <div class="skills">
                            <span class="skill">Zapier</span>
                            <span class="skill">Active Directory</span>
                            <span class="skill">Photoshop</span>
                            <span class="skill">Premiere pro</span>
                        </div>
                    </div>
                    <div class="competence-card">
                        <div class="competence-icon">
                            <i class="fas fa-database"></i>
                        </div>
                        <h3>Base de Données</h3>
                        <div class="skills">
                            <span class="skill">MySQL</span>
                            <span class="skill">PostgreSQL</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Section Parcours --><!--
        <section id="parcours" class="parcours">
            <div class="container">
                <h2 class="titreParcours">Mon Parcours</h2>
                <div class="timeline">
                    <div class="timeline-item">
                        <div class="timeline-date">2025 - 2027</div>
                        <div class="timeline-content">
                            <h3>Master Expert en Informatique et Système d'information</h3>
                            <p>IRUP, Saint-Étienne</p>
                        </div>
                    </div>
                    <div class="timeline-item">
                        <div class="timeline-date">2024 - 2025</div>
                        <div class="timeline-content">
                            <h3>Licence Informatique</h3>
                            <p>Institut Supérieur St-Denis, Annonay</p>
                        </div>
                    </div>
                    <div class="timeline-item">
                        <div class="timeline-date">2022 - 2024</div>
                        <div class="timeline-content">
                            <h3>BTS SIO</h3>
                            <p>Institut Supérieur St-Denis, Annonay</p>
                        </div>
                    </div>
                    <div class="timeline-item">
                        <div class="timeline-date">2020 - 2022</div>
                        <div class="timeline-content">
                            <h3>Bac STI2D</h3>
                            <p>Lycée St-Denis, Annonay</p>
                        </div>
                    </div>
                </div>
            </div>
        </section>-->

        <!-- Section Contact -->
        <section id="contact" class="contact">
            <div class="container">
                <h2>Me Contacter</h2>
                <div class="contact-content">

                    <form class="contact-form" method="POST">
                        <div class="form-group">
                            <input type="text" name="nom" placeholder="Votre nom" required>
                        </div>
                        <div class="form-group">
                            <input type="email" name="email" placeholder="Votre email" required>
                        </div>
                        <div class="form-group">
                            <input type="text" name="sujet" placeholder="Sujet" required>
                        </div>
                        <div class="form-group">
                            <textarea name="message" placeholder="Votre message" rows="5" required></textarea>
                        </div>
                        <button type="submit" class="btn btn-primary">Envoyer le Message</button>
                    </form>

                </div>
            </div>
        </section>
    </main>

    <footer class="footer">
        <div class="container">
            <p>&copy; 2025 Quentin Chirat. Tous droits réservés.</p>
            <div class="social-links">
                <a href="https://www.linkedin.com/in/quentin-chirat-90999124b/" target="_blank"><i class="fab fa-linkedin"></i></a>
            </div>
        </div>
    </footer>
    <!--<script src="https://www.quentin-chirat.com/chatbot/widget.js"></script>-->

    <script src="script.js"></script>
</body>

</html>