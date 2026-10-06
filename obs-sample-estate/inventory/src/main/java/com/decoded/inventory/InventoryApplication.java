// inventory: the Spring Boot application class (obs-sample-estate, all
// stages). Scheduling is on for the five-minute stock reconciliation that
// produces lab 04's anomaly.
package com.decoded.inventory;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class InventoryApplication {
    public static void main(String[] args) {
        SpringApplication.run(InventoryApplication.class, args);
    }
}
