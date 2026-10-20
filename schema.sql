CREATE DATABASE IF NOT EXISTS automeasure;
USE automeasure;

CREATE TABLE IF NOT EXISTS measurements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    label VARCHAR(100),
    width_cm DOUBLE NOT NULL,
    height_cm DOUBLE NOT NULL,
    source ENUM('camera','upload') NOT NULL,
    image_path VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
