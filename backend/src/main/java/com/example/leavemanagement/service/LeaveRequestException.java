package com.example.leavemanagement.service;

public class LeaveRequestException extends RuntimeException {
    public enum Kind { NOT_FOUND, INVALID_REQUEST, CONFLICT }

    private final Kind kind;

    public LeaveRequestException(Kind kind, String message) {
        super(message);
        this.kind = kind;
    }

    public Kind getKind() {
        return kind;
    }
}
