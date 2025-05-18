package com.knockknock // Adjust if your package name is different

import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise // Optional: for returning status

class MicrophoneModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "MicrophoneModule"
    }

    override fun getName(): String {
        // This name is used to access the module from JavaScript
        return "MicrophoneServiceModule"
    }

    @ReactMethod
    fun startService(promise: Promise) { // Added Promise for feedback
        Log.d(TAG, "Attempting to start MicrophoneService")
        try {
            val serviceIntent = Intent(reactApplicationContext, MicrophoneService::class.java)
            serviceIntent.action = MicrophoneService.ACTION_START

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(serviceIntent)
            } else {
                reactApplicationContext.startService(serviceIntent)
            }
            Log.i(TAG, "MicrophoneService start command sent")
            promise.resolve("Microphone service started successfully.")
        } catch (e: Exception) {
            Log.e(TAG, "Could not start MicrophoneService", e)
            promise.reject("SERVICE_START_ERROR", "Could not start microphone service: ${e.message}", e)
        }
    }

    @ReactMethod
    fun stopService(promise: Promise) { // Added Promise for feedback
        Log.d(TAG, "Attempting to stop MicrophoneService")
        try {
            val serviceIntent = Intent(reactApplicationContext, MicrophoneService::class.java)
            // No action needed for stopService, just calling stopService is enough
            // serviceIntent.action = MicrophoneService.ACTION_STOP // Alternatively send stop action

            val stopped = reactApplicationContext.stopService(serviceIntent)
            Log.i(TAG, "MicrophoneService stop command sent. Was service stopped? $stopped")
             if (stopped) {
                promise.resolve("Microphone service stopped successfully.")
            } else {
                // This might happen if the service wasn't running
                promise.resolve("Microphone service stop command sent, but service might not have been running.")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not stop MicrophoneService", e)
             promise.reject("SERVICE_STOP_ERROR", "Could not stop microphone service: ${e.message}", e)
        }
    }

    // Optional: Add constants if needed (e.g., action names)
    // override fun getConstants(): Map<String, Any>? {
    //     val constants: MutableMap<String, Any> = HashMap()
    //     constants["ACTION_START"] = MicrophoneService.ACTION_START
    //     constants["ACTION_STOP"] = MicrophoneService.ACTION_STOP
    //     return constants
    // }
}